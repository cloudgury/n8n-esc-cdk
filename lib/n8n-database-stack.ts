import {
  StackProps,
  Stack,
  aws_ssm as ssm,
  aws_ec2 as ec2,
  Duration,
  aws_iam as iam,
  RemovalPolicy,
  aws_secretsmanager as secretsmanager,
  SecretValue,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  ContainerImage,
  FargateTaskDefinition,
  LogDrivers,
  FargateService,
  Cluster,
  Volume,
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
import { Asset } from "aws-cdk-lib/aws-s3-assets";
import * as path from "path";

export interface N8nDatabaseStackProps extends StackProps {
  readonly prefix: string;
  readonly parameterHelper: ParameterHelper;
  readonly vpc: IVpc;
}

export class N8nDatabaseStack extends Stack {
  public readonly vpc: IVpc;
  public readonly taskExecutionRole: iam.Role;
  public readonly taskRole: iam.Role;
  public readonly dbClientSecurityGroup: ISecurityGroup;
  public readonly dbListenerSecurityGroup: ISecurityGroup;
  public readonly efsClientSecurityGroup: ISecurityGroup;
  public readonly ecsClusterAccess: SecurityGroup;

  constructor(scope: Construct, id: string, props: N8nDatabaseStackProps) {
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
    const postgresAccessPointId = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.postgresAccessPointIdParameterName()
    );
    const efsClientSecurityGroupId = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.efsClientSecurityGroupIdParameterName()
    );
    const rdsClientSecurityGroupId = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.dbClientSecurityGroupIdParameterName()
    );
    const rdsListenerSecurityGroupId = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.dbListenerSecurityGroupIdParameterName()
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

    // Import DB security group
    this.dbClientSecurityGroup = SecurityGroup.fromSecurityGroupId(
      this,
      "ImportedDbSecurityGroup",
      rdsClientSecurityGroupId
    ) as ISecurityGroup;

    // Import DB listener security group
    this.dbListenerSecurityGroup = SecurityGroup.fromSecurityGroupId(
      this,
      "ImportedDbListenerSecurityGroup",
      rdsListenerSecurityGroupId
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

    // Postgres container
    const dbRootUsername = "postgres";
    const dbTargetName = "n8n";
    const dbAppUser = "n8nuser";

    // Create and retrieve n8n encryption key secret
    const PostgresAdminSecret = new secretsmanager.Secret(
      this,
      "N8nPostgresRootPasswordSecret",
      {
        secretName: props.parameterHelper.postgresAdminSecretName(),
        description: "Encryption key for n8n",
        generateSecretString: {
          secretStringTemplate: JSON.stringify({
            username: dbRootUsername,
          }),
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

    const PostgresAppSecret = new secretsmanager.Secret(
      this,
      "N8nPostgresAppPasswordSecret",
      {
        secretName: props.parameterHelper.postgresAppSecretName(),
        description: "Encryption key for n8n",
        secretObjectValue: {
          username: SecretValue.unsafePlainText(dbAppUser),
          password: SecretValue.unsafePlainText("n8npassword123"),
        },
      }
    );

    this.ecsClusterAccess = new SecurityGroup(this, "ecsClusterAccess", {
      vpc: this.vpc,
      description: "ClusterAccessS All",
      allowAllOutbound: true,
      securityGroupName: `${props.prefix}-ecs-cluster-access`,
    });

    // Allow inbound traffic from the ECS cluster
    this.ecsClusterAccess.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.allTraffic(),
      "Allow inbound traffic from within VPC"
    );

    // Create execution role with necessary permissions
    this.taskExecutionRole = new iam.Role(this, "N8nTaskExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      roleName: `${props.prefix}TaskExecutionRole`,
      description: "Execution role for N8n database ECS tasks",
    });

    // Add permissions for Secrets Manager
    const secretArns = [
      PostgresAdminSecret.secretArn,
      PostgresAppSecret.secretArn,
    ];

    this.taskExecutionRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ],
        resources: secretArns,
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
          `arn:aws:elasticfilesystem:${this.region}:${this.account}:access-point/${postgresAccessPointId}`,
        ],
      })
    );

    // Add managed policy
    this.taskExecutionRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName("SecretsManagerReadWrite")
    );

    // Add SSM permissions
    const ssmParamArns = [
      `arn:aws:ssm:${this.region}:${
        this.account
      }:parameter${props.parameterHelper.postgresAdminSecretArn()}`,
      `arn:aws:ssm:${this.region}:${
        this.account
      }:parameter${props.parameterHelper.postgresAppSecretArn()}`,
    ];

    this.taskExecutionRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",
        ],
        resources: ssmParamArns,
      })
    );

    // Create task role with necessary permissions
    this.taskRole = new iam.Role(this, "N8nDatabaseTaskRole", {
      roleName: `${props.prefix}N8nDatabaseTaskRole`,
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "Role for N8n database ECS tasks",
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
          `arn:aws:elasticfilesystem:${this.region}:${this.account}:access-point/${postgresAccessPointId}`,
        ],
      })
    );

    // Add permissions to download the script from S3
    this.taskRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket",
          "s3:DeleteObject",
          "s3:GetBucketLocation",
        ],
        resources: ["*"],
        effect: iam.Effect.ALLOW,
      })
    );

    // Add this for ListAllMyBuckets (must use resource "*")
    this.taskRole.addToPolicy(
      new PolicyStatement({
        actions: ["s3:ListAllMyBuckets"],
        resources: ["*"],
        effect: iam.Effect.ALLOW,
      })
    );

    // Add permissions to access Secrets Manager
    this.taskRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ],
        resources: [PostgresAdminSecret.secretArn, PostgresAppSecret.secretArn],
      })
    );

    // Postgres volume
    const postgresVolume: Volume = {
      name: "db_storage",
      efsVolumeConfiguration: {
        fileSystemId: efsId,
        transitEncryption: "ENABLED",
        authorizationConfig: {
          accessPointId: postgresAccessPointId,
          iam: "ENABLED",
        },
      },
    };

    // Create log group for postgres service
    const postgresLogGroup = new LogGroup(this, "PostgresLogGroup", {
      logGroupName: `/ecs/${props.prefix}/postgres`,
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Create an asset from the init-db.sh script file
    const initDbScriptAsset = new Asset(this, "InitDbScriptAsset", {
      path: path.join(__dirname, "..", "scripts", "init-db.sh"),
    });

    // PostgreSQL Task Definition
    const postgresTaskDef = new FargateTaskDefinition(this, "PostgresTaskDef", {
      executionRole: this.taskExecutionRole,
      taskRole: this.taskRole,
      cpu: 1024,
      memoryLimitMiB: 2048,
      volumes: [postgresVolume],
      family: "n8n-postgres-task",
    });

    const postgresContainer = postgresTaskDef.addContainer("postgres", {
      image: ContainerImage.fromRegistry("postgres:16"),
      essential: true,
      logging: LogDrivers.awsLogs({
        streamPrefix: "postgres",
        logGroup: postgresLogGroup,
      }),
      environment: {
        PGDATA: "/var/lib/postgresql/data/pgdata",
        POSTGRES_INITDB_ARGS: "--data-checksums",
        TARGET_DB_NAME: dbTargetName,
        DROP_DB: "false",
        ADMIN_SECRET_NAME: props.parameterHelper.postgresAdminSecretName(),
        APP_SECRET_NAME: props.parameterHelper.postgresAppSecretName(),
        INIT_SCRIPT_URL: initDbScriptAsset.s3ObjectUrl,
      },
      secrets: {
        POSTGRES_PASSWORD: EcsSecret.fromSecretsManager(
          PostgresAdminSecret,
          "password"
        ),
        POSTGRES_USER: EcsSecret.fromSecretsManager(
          PostgresAdminSecret,
          "username"
        ),
        POSTGRES_NON_ROOT_USER: EcsSecret.fromSecretsManager(
          PostgresAppSecret,
          "username"
        ),
        POSTGRES_NON_ROOT_PASSWORD: EcsSecret.fromSecretsManager(
          PostgresAppSecret,
          "password"
        ),
      },
      healthCheck: {
        command: [
          "CMD-SHELL",
          `pg_isready -h localhost -U ${dbRootUsername} -d postgres`,
        ],
        interval: Duration.seconds(5),
        timeout: Duration.seconds(5),
        retries: 10,
        startPeriod: Duration.seconds(10),
      },
      entryPoint: ["sh", "-c"],
      command: [
        "if [ -f /var/lib/postgresql/data/pgdata/postmaster.pid ]; then rm -f /var/lib/postgresql/data/pgdata/postmaster.pid; fi && " +
          "mkdir -p /scripts && " +
          "apt-get update && apt-get install -y curl postgresql-client awscli jq && " +
          "echo 'Downloading initialization script...' && " +
          "aws s3 ls  && " +
          "aws s3 cp ${INIT_SCRIPT_URL} /scripts/init-postgres.sh && " +
          "chmod +x /scripts/init-postgres.sh && " +
          "echo 'Initialization script downloaded to /scripts/init-postgres.sh' && " +
          "echo 'You can run it manually with: docker exec -it <container-id> /scripts/init-postgres.sh' && " +
          "find /var/lib/postgresql -type d -exec chmod 0750 {} \\; && " +
          "find /var/lib/postgresql -type f -exec chmod 0640 {} \\; && " +
          "docker-entrypoint.sh postgres",
      ],
    });

    // Mount point for postgres
    postgresContainer.addMountPoints({
      sourceVolume: "db_storage",
      containerPath: "/var/lib/postgresql/data",
      readOnly: false,
    });

    // PostgreSQL service with service discovery
    const postgresService = new FargateService(this, "PostgresService", {
      cluster,
      serviceName: "postgres-service",
      taskDefinition: postgresTaskDef,
      desiredCount: 1,
      securityGroups: [
        this.efsClientSecurityGroup,
        this.dbListenerSecurityGroup,
        this.ecsClusterAccess,
      ],
      cloudMapOptions: {
        name: "postgres",
        dnsRecordType: DnsRecordType.A,
        dnsTtl: Duration.seconds(30),
        containerPort: 5432,
        cloudMapNamespace: namespace,
      },
      enableExecuteCommand: true,
    });

    // Store important parameters for cross-stack references
    new ssm.StringParameter(this, "PostgresHost", {
      parameterName: props.parameterHelper.postgresHost(),
      stringValue: `postgres.${namespaceName}`,
    });

    new ssm.StringParameter(this, "PostgresPort", {
      parameterName: props.parameterHelper.postgresPort(),
      stringValue: "5432",
    });

    new ssm.StringParameter(this, "PostgresUsername", {
      parameterName: props.parameterHelper.postgresRootUsername(),
      stringValue: dbRootUsername,
    });

    new ssm.StringParameter(this, "PostgresDatabase", {
      parameterName: props.parameterHelper.postgresN8nDatabase(),
      stringValue: dbTargetName,
    });

    new ssm.StringParameter(this, "PostgresNonRootUser", {
      parameterName: props.parameterHelper.postgresNonRootUser(),
      stringValue: dbAppUser,
    });

    new ssm.StringParameter(this, "PostgresAdminSecretArn", {
      parameterName: props.parameterHelper.postgresAdminSecretArn(),
      stringValue: PostgresAdminSecret.secretArn,
    });

    new ssm.StringParameter(this, "PostgresAppSecretArn", {
      parameterName: props.parameterHelper.postgresAppSecretArn(),
      stringValue: PostgresAppSecret.secretArn,
    });

    new ssm.StringParameter(this, "PostgresAppSecretName", {
      parameterName: props.parameterHelper.postgresAppSecretName(),
      stringValue: PostgresAppSecret.secretName,
    });

    new ssm.StringParameter(this, "PostgresAdminSecretName", {
      parameterName: props.parameterHelper.postgresAdminSecretName(),
      stringValue: PostgresAdminSecret.secretName,
    });
  }
}
