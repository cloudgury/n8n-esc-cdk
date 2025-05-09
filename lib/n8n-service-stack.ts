import {
  StackProps,
  Stack,
  aws_ssm as ssm,
  aws_ec2 as ec2,
  Duration,
  aws_secretsmanager as secretsmanager,
  aws_iam as iam,
  RemovalPolicy,
  aws_s3 as s3,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  ContainerImage,
  FargateTaskDefinition,
  LogDrivers,
  FargateService,
  Cluster,
  Volume,
  Protocol,
  Secret as EcsSecret,
} from "aws-cdk-lib/aws-ecs";
import { SecurityGroup, ISecurityGroup } from "aws-cdk-lib/aws-ec2";
import { PolicyStatement, ManagedPolicy } from "aws-cdk-lib/aws-iam";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { IVpc } from "aws-cdk-lib/aws-ec2";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { ParameterHelper } from "@/utils/parameter-helper";
import {
  PrivateDnsNamespace,
  DnsRecordType,
} from "aws-cdk-lib/aws-servicediscovery";

export interface N8nServiceStackProps extends StackProps {
  readonly prefix: string;
  readonly parameterHelper: ParameterHelper;
  readonly vpc: IVpc;
}

export class N8nServiceStack extends Stack {
  public readonly vpc: IVpc;

  constructor(scope: Construct, id: string, props: N8nServiceStackProps) {
    super(scope, id, props);

    this.vpc = props.vpc;

    // Get values from SSM parameters
    const clusterName = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.ecsClusterName()
    );
    const efsId = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.efsId()
    );
    const n8nAccessPointId = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.n8nAccessPointId()
    );
    const efsClientSecurityGroupId = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.efsClientSecurityGroupIdParameterName()
    );
    const rdsClientSecurityGroupId = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.dbClientSecurityGroupIdParameterName()
    );

    // Get service discovery namespace
    const namespaceId = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.namespaceIdParameterName()
    );
    const namespaceName = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.namespaceNameParameterName()
    );
    const namespaceArn = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.namespaceArnParameterName()
    );

    // Get database connection parameters
    //postgres.n8n.internal
    const dbHost = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.postgresHost()
    );
    //5432
    const dbPort = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.postgresPort()
    );

    // new code
    // Get DB Application credentials password
    const dbAppSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "DbSecret",
      props.parameterHelper.postgresAppSecretName()
    );
    // Get Redis password

    //n8n
    const dbN8nName = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.postgresN8nDatabase()
    );

    // Redis password and other information
    const redisSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "DbRedisSecret",
      props.parameterHelper.redisPasswordSecretName()
    );

    const redisHost = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.redisHost()
    );
    const redisPort = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.redisPort()
    );

    // Create and retrieve n8n encryption key secret
    const encryptionKeySecret = new secretsmanager.Secret(
      this,
      "N8nEncryptionKey",
      {
        secretName: `/${props.prefix}/encryption-key`,
        description: "Encryption key for n8n",
        generateSecretString: {
          secretStringTemplate: JSON.stringify({}),
          generateStringKey: "ENCRYPTION_KEY",
          excludeCharacters: "'\"\\",
          passwordLength: 32,
        },
      }
    );

    // Import EFS security group
    const efsClientSecurityGroup = SecurityGroup.fromSecurityGroupId(
      this,
      "ImportedEfsSecurityGroup",
      efsClientSecurityGroupId
    ) as ISecurityGroup;

    // Import DB security group
    const dbClientSecurityGroup = SecurityGroup.fromSecurityGroupId(
      this,
      "ImportedDbSecurityGroup",
      rdsClientSecurityGroupId
    ) as ISecurityGroup;

    // Import cluster
    const cluster = Cluster.fromClusterAttributes(this, "ImportedCluster", {
      clusterName: clusterName,
      vpc: this.vpc,
      securityGroups: [],
    });

    // Import service discovery namespace
    const namespace = PrivateDnsNamespace.fromPrivateDnsNamespaceAttributes(
      this,
      "ImportedNamespace",
      {
        namespaceId,
        namespaceName,
        namespaceArn,
      }
    );

    // Create security group for n8n services
    const n8nServiceSG = new SecurityGroup(this, "N8nServiceSG", {
      vpc: this.vpc,
      securityGroupName: `${props.prefix}-main-service-sg`,
      description: "Security group for n8n services",
      allowAllOutbound: true,
    });

    const ecsClusterAccess = new SecurityGroup(this, "ecsClusterAccess", {
      vpc: this.vpc,
      securityGroupName: `${props.prefix}-ecs-main-cluster-access`,
      description: "ClusterAccessS All",
      allowAllOutbound: true,
    });

    // Allow inbound traffic from the ECS cluster
    ecsClusterAccess.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.allTraffic(),
      "Allow inbound traffic from within VPC"
    );

    // Allow outbound traffic to EFS
    n8nServiceSG.addEgressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(2049),
      "Allow outbound NFS traffic to EFS"
    );

    // Explicitly allow NFS access from the security group to the EFS security group
    efsClientSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(n8nServiceSG.securityGroupId),
      ec2.Port.tcp(2049),
      "Allow inbound NFS traffic from n8n service"
    );

    // Ensure EFS client security group can access all mount targets
    n8nServiceSG.addEgressRule(
      efsClientSecurityGroup,
      ec2.Port.allTraffic(),
      "Allow all traffic to EFS security group"
    );

    // Create execution role with necessary permissions
    const taskExecutionRole = new iam.Role(this, "N8nTaskExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "Execution role for N8n service ECS tasks",
      roleName: `${props.prefix}ServiceTaskExecutionRole`,
    });

    // Add permissions for Secrets Manager
    taskExecutionRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ],
        resources: ["*"],
      })
    );

    // Add permissions for KMS
    taskExecutionRole.addToPolicy(
      new PolicyStatement({
        actions: ["kms:Decrypt", "kms:DescribeKey"],
        resources: ["*"],
      })
    );

    // Add permissions for CloudWatch Logs
    taskExecutionRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "logs:CreateLogStream",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
          "logs:PutLogEvents",
        ],
        resources: ["*"],
      })
    );

    // Add EFS-specific permissions
    taskExecutionRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientWrite",
          "elasticfilesystem:ClientRootAccess",
          "elasticfilesystem:DescribeMountTargets",
          "elasticfilesystem:DescribeAccessPoints",
          "elasticfilesystem:DescribeFileSystems",
        ],
        resources: [
          `arn:aws:elasticfilesystem:${this.region}:${this.account}:file-system/${efsId}`,
          `arn:aws:elasticfilesystem:${this.region}:${this.account}:access-point/${n8nAccessPointId}`,
        ],
      })
    );

    // Add managed policy
    taskExecutionRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName("SecretsManagerReadWrite")
    );

    // Create task role with necessary permissions
    const taskRole = new iam.Role(this, "N8nTaskRole", {
      roleName: `${props.prefix}ServiceTaskRole`,
      description: "Role for N8n service ECS tasks",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    // Add EFS-specific permissions to the task role
    taskRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientWrite",
          "elasticfilesystem:ClientRootAccess",
          "elasticfilesystem:DescribeMountTargets",
          "elasticfilesystem:DescribeAccessPoints",
          "elasticfilesystem:DescribeFileSystems",
        ],
        resources: [
          `arn:aws:elasticfilesystem:${this.region}:${this.account}:file-system/${efsId}`,
          `arn:aws:elasticfilesystem:${this.region}:${this.account}:access-point/${n8nAccessPointId}`,
        ],
      })
    );

    // Add S3 permissions to the task role
    taskRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket",
          "s3:DeleteObject",
          "s3:GetBucketLocation",
        ],
        resources: [
          `arn:aws:s3:::n8n-storage-${this.account}-${this.region}`,
          `arn:aws:s3:::n8n-storage-${this.account}-${this.region}/*`,
        ],
      })
    );

    // Create S3 bucket for n8n storage
    // const n8nStorageBucket = new s3.Bucket(this, "N8nStorageBucket", {
    //   bucketName: `n8n-storage-${this.account}-${this.region}`,
    //   removalPolicy: RemovalPolicy.DESTROY,
    //   autoDeleteObjects: false,
    //   blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    //   encryption: s3.BucketEncryption.S3_MANAGED,
    // });

    // n8n volume
    const n8nVolume: Volume = {
      name: "n8n_storage",
      efsVolumeConfiguration: {
        fileSystemId: efsId,
        transitEncryption: "ENABLED",
        authorizationConfig: {
          accessPointId: n8nAccessPointId,
          iam: "ENABLED",
        },
        rootDirectory: "/",
      },
    };

    // Create log groups for n8n services
    const n8nLogGroup = new LogGroup(this, "N8nLogGroup", {
      logGroupName: `/ecs/${props.prefix}/n8n`,
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const n8nWorkerLogGroup = new LogGroup(this, "N8nWorkerLogGroup", {
      logGroupName: `/ecs/${props.prefix}/n8n-worker`,
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Shared container configuration for n8n services
    const sharedN8nConfig = {
      image: ContainerImage.fromRegistry("docker.n8n.io/n8nio/n8n"),
      essential: true,
      environment: {
        DB_TYPE: "postgresdb",
        DB_POSTGRESDB_HOST: dbHost, //postgres.n8n.internal
        DB_POSTGRESDB_PORT: dbPort, //5432
        DB_POSTGRESDB_DATABASE: dbN8nName, //n8n
        DB_POSTGRESDB_CONNECTION_TIMEOUT: "60000",
        DB_POSTGRESDB_CONNECTION_RETRIES: "3",
        DB_POSTGRESDB_LOG_LEVEL: "verbose",
        N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: "false",
        N8N_SECURE_COOKIE: "false",
        N8N_METRICS: "true",
        N8N_COMMUNITY_PACKAGES_ENABLED: "true",
        N8N_COMMUNITY_PACKAGES_PREVIEW: "true",
        GENERIC_TIMEZONE: "America/New_York",
        N8N_RUNNERS_ENABLED: "true",
        N8N_LOG_LEVEL: "debug",
        EXECUTIONS_MODE: "queue",
        QUEUE_BULL_REDIS_HOST: redisHost,
        QUEUE_HEALTH_CHECK_ACTIVE: "true",
        QUEUE_BULL_REDIS_PORT: redisPort,
        QUEUE_BULL_REDIS_USERNAME: "default",
        OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS: "true",
        // Configure S3 storage for n8n
        // N8N_BINARY_DATA_MANAGER: "s3",
        // N8N_AVAILABLE_BINARY_DATA_MODES: "s3",
        // N8N_DEFAULT_BINARY_DATA_MODE: "s3",
        // N8N_BINARY_DATA_STORAGE_PATH: "/home/node/.n8n/data/binary",
        // N8N_BINARY_DATA_S3_BUCKET: `n8n-storage-${this.account}-${this.region}`,
        // N8N_BINARY_DATA_S3_REGION: this.region,
      },
      secrets: {
        N8N_ENCRYPTION_KEY: EcsSecret.fromSecretsManager(
          encryptionKeySecret,
          "ENCRYPTION_KEY"
        ),
        QUEUE_BULL_REDIS_PASSWORD: EcsSecret.fromSecretsManager(
          redisSecret,
          "password"
        ),
        DB_POSTGRESDB_USER: EcsSecret.fromSecretsManager(
          dbAppSecret,
          "username"
        ),
        DB_POSTGRESDB_PASSWORD: EcsSecret.fromSecretsManager(
          dbAppSecret,
          "password"
        ),
      },
    };

    const n8nSharedTaskDef = {
      executionRole: taskExecutionRole,
      taskRole: taskRole,
      cpu: 1024,
      memoryLimitMiB: 2048,
      volumes: [n8nVolume],
    };

    // n8n Main Task Definition
    const n8nTaskDef = new FargateTaskDefinition(this, "N8nTaskDef", {
      ...n8nSharedTaskDef,
      family: "n8n-main-task",
    });

    // n8n Worker Task Definition
    const n8nWorkerTaskDef = new FargateTaskDefinition(
      this,
      "N8nWorkerTaskDef",
      {
        ...n8nSharedTaskDef,
        family: "n8n-worker-task",
      }
    );

    // n8n main container
    const n8nContainer = n8nTaskDef.addContainer("n8n", {
      ...sharedN8nConfig,
      logging: LogDrivers.awsLogs({
        streamPrefix: "n8n",
        logGroup: n8nLogGroup,
      }),
      entryPoint: ["/bin/sh", "-c"],
      command: ["node /usr/local/lib/node_modules/n8n/bin/n8n start"],
      portMappings: [
        {
          containerPort: 5678,
          hostPort: 5678,
          protocol: Protocol.TCP,
        },
      ],
      healthCheck: {
        command: [
          "CMD-SHELL",
          "wget --spider --quiet --tries=1 --timeout=5 http://localhost:5678/healthz || exit 1",
        ],
        interval: Duration.seconds(60),
        timeout: Duration.seconds(10),
        retries: 5,
        startPeriod: Duration.seconds(120),
      },
    });

    // Mount point for n8n - temporarily disabled
    n8nContainer.addMountPoints({
      sourceVolume: "n8n_storage",
      containerPath: "/home/node/.n8n",
      readOnly: false,
    });

    // n8n worker container
    const n8nWorkerContainer = n8nWorkerTaskDef.addContainer("n8n-worker", {
      ...sharedN8nConfig,
      logging: LogDrivers.awsLogs({
        streamPrefix: "n8n-worker",
        logGroup: n8nWorkerLogGroup,
      }),
      command: ["worker"],
    });

    // Mount point for n8n worker - temporarily disabled

    n8nWorkerContainer.addMountPoints({
      sourceVolume: "n8n_storage",
      containerPath: "/home/node/.n8n",
      readOnly: false,
    });

    // n8n main service
    const n8nService = new FargateService(this, "N8nService", {
      cluster,
      serviceName: "n8n-service",
      taskDefinition: n8nTaskDef,
      desiredCount: 1,
      securityGroups: [
        n8nServiceSG,
        dbClientSecurityGroup,
        efsClientSecurityGroup,
        ecsClusterAccess,
      ],
      cloudMapOptions: {
        name: "n8n",
        dnsRecordType: DnsRecordType.A,
        dnsTtl: Duration.seconds(30),
        cloudMapNamespace: namespace,
        containerPort: 5678,
      },
      enableExecuteCommand: true,
    });

    // n8n worker service - temporarily disabled
    const n8nWorkerService = new FargateService(this, "N8nWorkersService", {
      cluster,
      serviceName: "n8n-worker-service",
      taskDefinition: n8nWorkerTaskDef,
      desiredCount: 1,
      securityGroups: [
        n8nServiceSG,
        dbClientSecurityGroup,
        efsClientSecurityGroup,
        ecsClusterAccess,
      ],
      cloudMapOptions: {
        name: "n8n-worker",
        dnsRecordType: DnsRecordType.A,
        dnsTtl: Duration.seconds(30),
        cloudMapNamespace: namespace,
      },
      enableExecuteCommand: true,
    });

    const createAlb = true;
    if (createAlb) {
      // Create Application Load Balancer for n8n
      const alb = new ApplicationLoadBalancer(this, "N8nALB", {
        vpc: this.vpc,
        loadBalancerName: `${props.prefix}-n8n-alb`,
        internetFacing: true,
        securityGroup: n8nServiceSG,
      });

      // Update container environment with ALB DNS name
      n8nContainer.addEnvironment(
        "WEBHOOK_URL",
        `http://${alb.loadBalancerDnsName}`
      );
      n8nContainer.addEnvironment(
        "N8N_WEBHOOK_URL",
        `http://${alb.loadBalancerDnsName}`
      );

      // // Add listener and target group
      const listener = alb.addListener("N8nListener", {
        port: 80,
        protocol: ApplicationProtocol.HTTP,
        open: true,
      });

      // // Add target to listener
      listener.addTargets("N8nTargets", {
        port: 5678,
        protocol: ApplicationProtocol.HTTP,
        targets: [n8nService],
        healthCheck: {
          path: "/healthz",
          interval: Duration.seconds(60),
          timeout: Duration.seconds(10),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 5,
        },
      });
    }
    // SSL termination is not needed for now
    //Pre-Req: ACM certificate in us-east-1
    //const certificateArn = "arn:aws:acm:us-east-1:<AWS-ACCOUNT-ID>:certificate/12345678-1234-1234-1234-123456789012";

    // // Import the ACM certificate
    // const certificate = Certificate.fromCertificateArn(
    //   this,
    //   "N8nSSLCert",
    //   certificateArn
    // );

    // // Add HTTPS listener
    // const httpsListener = alb.addListener("N8nHTTPSListener", {
    //   port: 443,
    //   protocol: ApplicationProtocol.HTTPS,
    //   certificates: [certificate],
    //   open: true,
    // });

    // // Add target to HTTPS listener
    // httpsListener.addTargets("N8nHTTPSTargets", {
    //   port: 5678,
    //   protocol: ApplicationProtocol.HTTP,
    //   targets: [n8nService],
    //   healthCheck: {
    //     path: "/healthz",
    //     interval: Duration.seconds(60),
    //     timeout: Duration.seconds(10),
    //     healthyThresholdCount: 2,
    //     unhealthyThresholdCount: 5,
    //   },
    // });
  }
}
