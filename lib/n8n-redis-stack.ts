import {
  StackProps,
  Stack,
  aws_ssm as ssm,
  aws_ec2 as ec2,
  Duration,
  aws_iam as iam,
  RemovalPolicy,
  aws_secretsmanager as secretsmanager,
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
import { IVpc } from "aws-cdk-lib/aws-ec2";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { ParameterHelper } from "@/utils/parameter-helper";
import {
  PrivateDnsNamespace,
  DnsRecordType,
} from "aws-cdk-lib/aws-servicediscovery";

export interface N8nRedisStackProps extends StackProps {
  readonly prefix: string;
  readonly parameterHelper: ParameterHelper;
  readonly vpc: IVpc;
}

export class N8nRedisStack extends Stack {
  public readonly vpc: IVpc;
  public readonly taskExecutionRole: iam.Role;
  public readonly taskRole: iam.Role;
  public readonly efsClientSecurityGroup: ISecurityGroup;
  public readonly redisSecurityGroup: ISecurityGroup;
  public readonly ecsClusterAccess: SecurityGroup;

  constructor(scope: Construct, id: string, props: N8nRedisStackProps) {
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
    const redisAccessPointId = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.redisAccessPointIdParameterName()
    );
    const efsClientSecurityGroupId = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.efsClientSecurityGroupIdParameterName()
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

    // Import EFS security group
    this.efsClientSecurityGroup = SecurityGroup.fromSecurityGroupId(
      this,
      "ImportedEfsSecurityGroup",
      efsClientSecurityGroupId
    ) as ISecurityGroup;

    // Create Redis security group
    this.redisSecurityGroup = new SecurityGroup(this, "RedisSecurityGroup", {
      vpc: this.vpc,
      securityGroupName: `${props.prefix}-redis-security-group`,
      description: "Security group for Redis",
      allowAllOutbound: true,
    });

    // Allow Redis port
    this.redisSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(6379),
      "Allow Redis traffic within VPC"
    );

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

    this.ecsClusterAccess = new SecurityGroup(this, "ecsClusterAccess", {
      vpc: this.vpc,
      securityGroupName: `${props.prefix}-ecs-redis-cluster-access`,
      description: "ClusterAccessS All",
      allowAllOutbound: true,
    });

    // Allow inbound traffic from the ECS cluster
    this.ecsClusterAccess.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.allTraffic(),
      "Allow inbound traffic from within VPC"
    );

    // Create execution role with necessary permissions
    this.taskExecutionRole = new iam.Role(this, "N8nRedisTaskExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      roleName: `${props.prefix}RedisTaskExecutionRole`,
      description: "Execution role for N8n Redis ECS tasks",
    });

    // Create and retrieve Redis password secret
    const redisPasswordSecret = new secretsmanager.Secret(
      this,
      "N8nRedisPasswordSecret",
      {
        secretName: props.parameterHelper.redisPasswordSecretName(),
        description: "Redis password for n8n",
        generateSecretString: {
          secretStringTemplate: JSON.stringify({}),
          generateStringKey: "password",
          excludeCharacters:
            "!@#$%^&*()_+-=[]{}|;:'\",.<>/?`~\\/@#$%^&*()_+{}[]|\\:;<>,.?/~`",
          passwordLength: 8,
          requireEachIncludedType: false,
          excludePunctuation: true,
          excludeUppercase: true,
          excludeLowercase: false,
          excludeNumbers: false,
        },
      }
    );

    // Add permissions for Secrets Manager
    this.taskExecutionRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ],
        resources: [redisPasswordSecret.secretArn],
      })
    );

    // Add permissions for KMS
    this.taskExecutionRole.addToPolicy(
      new PolicyStatement({
        actions: ["kms:Decrypt", "kms:DescribeKey"],
        resources: ["*"],
      })
    );

    // Add permissions for CloudWatch Logs
    this.taskExecutionRole.addToPolicy(
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
    this.taskExecutionRole.addToPolicy(
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
          `arn:aws:elasticfilesystem:${this.region}:${this.account}:access-point/${redisAccessPointId}`,
        ],
      })
    );

    // Add managed policy
    this.taskExecutionRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName("SecretsManagerReadWrite")
    );

    // Create task role with necessary permissions
    this.taskRole = new iam.Role(this, "N8nRedisTaskRole", {
      roleName: `${props.prefix}-RedisTaskRole`,
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "Role for N8n Redis ECS tasks",
    });

    // Add EFS-specific permissions to the task role
    this.taskRole.addToPolicy(
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
          `arn:aws:elasticfilesystem:${this.region}:${this.account}:access-point/${redisAccessPointId}`,
        ],
      })
    );

    // Add permissions to access Secrets Manager for the task role
    this.taskRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ],
        resources: [redisPasswordSecret.secretArn],
      })
    );

    // Redis volume
    const redisVolume: Volume = {
      name: "redis_data",
      efsVolumeConfiguration: {
        fileSystemId: efsId,
        transitEncryption: "ENABLED",
        authorizationConfig: {
          accessPointId: redisAccessPointId,
          iam: "ENABLED",
        },
      },
    };

    // Create log group for Redis service
    const redisLogGroup = new LogGroup(this, "RedisLogGroup", {
      logGroupName: `/ecs/${props.prefix}/redis`,
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Redis Task Definition
    const redisTaskDef = new FargateTaskDefinition(this, "RedisTaskDef", {
      executionRole: this.taskExecutionRole,
      taskRole: this.taskRole,
      cpu: 512,
      memoryLimitMiB: 1024,
      volumes: [redisVolume],
      family: "n8n-redis-task",
    });

    // Redis container
    const redisContainer = redisTaskDef.addContainer("redis", {
      image: ContainerImage.fromRegistry("redis:7"),
      essential: true,
      logging: LogDrivers.awsLogs({
        streamPrefix: "redis",
        logGroup: redisLogGroup,
      }),
      secrets: {
        REDIS_PASSWORD: EcsSecret.fromSecretsManager(
          redisPasswordSecret,
          "password"
        ),
      },
      healthCheck: {
        command: ["CMD-SHELL", "redis-cli ping || exit 1"],
        interval: Duration.seconds(5),
        timeout: Duration.seconds(5),
        retries: 10,
        startPeriod: Duration.seconds(10),
      },
      command: ["sh", "-c", "exec redis-server --requirepass $REDIS_PASSWORD"],
      portMappings: [
        {
          containerPort: 6379,
          hostPort: 6379,
          protocol: Protocol.TCP,
        },
      ],
    });

    // Mount point for Redis
    redisContainer.addMountPoints({
      sourceVolume: "redis_data",
      containerPath: "/data",
      readOnly: false,
    });

    // Redis service with service discovery
    const redisService = new FargateService(this, "RedisService", {
      cluster,
      serviceName: "redis-service",
      taskDefinition: redisTaskDef,
      desiredCount: 1,
      securityGroups: [
        this.efsClientSecurityGroup,
        this.redisSecurityGroup,
        this.ecsClusterAccess,
      ],
      cloudMapOptions: {
        name: "redis",
        dnsRecordType: DnsRecordType.A,
        dnsTtl: Duration.seconds(30),
        containerPort: 6379,
        cloudMapNamespace: namespace,
      },
      enableExecuteCommand: true,
    });

    // Store important parameters for cross-stack references
    new ssm.StringParameter(this, "RedisHost", {
      parameterName: props.parameterHelper.redisHost(),
      stringValue: `redis.${namespaceName}`,
    });

    new ssm.StringParameter(this, "RedisPort", {
      parameterName: props.parameterHelper.redisPort(),
      stringValue: "6379",
    });

    new ssm.StringParameter(this, "RedisPasswordSecretArn", {
      parameterName: props.parameterHelper.redisPasswordSecretArn(),
      stringValue: redisPasswordSecret.secretArn,
    });
  }
}
