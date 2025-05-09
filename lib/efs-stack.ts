import {
  StackProps,
  Stack,
  RemovalPolicy,
  aws_ssm as ssm,
  aws_ec2 as ec2,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  FileSystem,
  PerformanceMode,
  ThroughputMode,
  AccessPoint,
  PosixUser,
} from "aws-cdk-lib/aws-efs";
import { IVpc, SecurityGroup, Peer, Port } from "aws-cdk-lib/aws-ec2";
import { ParameterHelper } from "@/utils/parameter-helper";

export interface EfsStackProps extends StackProps {
  parameterHelper: ParameterHelper;
  vpc: IVpc;
}

export class EfsStack extends Stack {
  public readonly fileSystem: FileSystem;
  public readonly vpc: IVpc;
  constructor(scope: Construct, id: string, props: EfsStackProps) {
    super(scope, id, props);

    this.vpc = props.vpc;
    // Create Database Client Security Group
    const efsClientSecurityGroup = new SecurityGroup(this, "efs-client-sg", {
      vpc: this.vpc,
      securityGroupName: `efs-client-sg`,
      description: "Allow clients access to EFS",
      allowAllOutbound: true,
    });

    // Create the security group first
    const efsListenerSecurityGroup = new SecurityGroup(
      this,
      "efs-listener-sg",
      {
        vpc: this.vpc,
        securityGroupName: "efs-listener-sg",
        allowAllOutbound: true,
        description: "Security group for EFS file system",
      }
    );

    // Allow all traffic from VPC CIDR range
    efsListenerSecurityGroup.addIngressRule(
      Peer.ipv4(props.vpc.vpcCidrBlock),
      Port.allTraffic(),
      "Allow all traffic from VPC CIDR"
    );

    // Allow connection from the database client
    efsListenerSecurityGroup.connections.allowFrom(
      new ec2.Connections({
        securityGroups: [efsClientSecurityGroup],
      }),
      Port.allTraffic(),
      "Allow connections from the clients for EfsClients"
    );

    // Allow all traffic from the security group itself (self-reference)
    efsListenerSecurityGroup.connections.allowFrom(
      efsListenerSecurityGroup,
      Port.allTraffic(),
      "Allow all traffic from self"
    );

    // Create the file system with the security group
    const fileSystem = new FileSystem(this, "efs", {
      vpc: this.vpc,
      securityGroup: efsListenerSecurityGroup,
      performanceMode: PerformanceMode.GENERAL_PURPOSE,
      throughputMode: ThroughputMode.BURSTING,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Create an EFS access point for PostgreSQL
    const postgresAccessPoint = new AccessPoint(this, "PostgresAccessPoint", {
      fileSystem: fileSystem,
      posixUser: {
        uid: "999",
        gid: "999",
      },
      createAcl: {
        ownerGid: "999",
        ownerUid: "999",
        permissions: "750",
      },
      path: "/postgresql",
    });

    // Create an EFS access point for Redis
    const redisAccessPoint = new AccessPoint(this, "RedisAccessPoint", {
      fileSystem: fileSystem,
      posixUser: {
        uid: "999",
        gid: "999",
      },
      createAcl: {
        ownerGid: "999",
        ownerUid: "999",
        permissions: "750",
      },
      path: "/redis",
    });

    // Create an N8N specific access point
    const n8nAccessPoint = new AccessPoint(this, "N8nAccessPoint", {
      fileSystem: fileSystem,
      posixUser: {
        uid: "1000",
        gid: "1000",
      },
      createAcl: {
        ownerGid: "1000",
        ownerUid: "1000",
        permissions: "777",
      },
      path: "/n8n",
    });

    // Store parameters in SSM after all resources are created
    new ssm.StringParameter(this, "ExportEfsId", {
      parameterName: props.parameterHelper.efsIdParameterName(),
      description: "Efs ID",
      stringValue: fileSystem.fileSystemId,
    });

    // Export the PostgreSQL Access Point ID to SSM
    new ssm.StringParameter(this, "ExportPostgresAccessPointId", {
      parameterName: props.parameterHelper.postgresAccessPointIdParameterName(),
      description: "PostgreSQL Access Point ID",
      stringValue: postgresAccessPoint.accessPointId,
    });

    // Export the Redis Access Point ID to SSM
    new ssm.StringParameter(this, "ExportRedisAccessPointId", {
      parameterName: props.parameterHelper.redisAccessPointIdParameterName(),
      description: "Redis Access Point ID",
      stringValue: redisAccessPoint.accessPointId,
    });

    // Export the N8N Access Point ID to SSM
    new ssm.StringParameter(this, "ExportN8nAccessPointId", {
      parameterName: props.parameterHelper.n8nAccessPointId(),
      description: "N8N Access Point ID",
      stringValue: n8nAccessPoint.accessPointId,
    });

    // Export the security group ID last to avoid circular dependencies
    new ssm.StringParameter(this, "ExportEfsListenerSecurityGroupId", {
      parameterName:
        props.parameterHelper.efsListenerSecurityGroupIdParameterName(),
      description: "EFS Listener Security Group ID",
      stringValue: efsListenerSecurityGroup.securityGroupId,
    });

    new ssm.StringParameter(this, "ExportEfsClientSecurityGroupId", {
      parameterName:
        props.parameterHelper.efsClientSecurityGroupIdParameterName(),
      description: "EFS Client Security Group ID",
      stringValue: efsClientSecurityGroup.securityGroupId,
    });
  }
}
