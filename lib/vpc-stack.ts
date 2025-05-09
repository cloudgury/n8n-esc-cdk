import { StackProps, Stack, aws_ssm as ssm, aws_ec2 as ec2 } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Vpc, SubnetType } from "aws-cdk-lib/aws-ec2";
import { ParameterHelper } from "@/utils/parameter-helper";

interface NetworkingStackProps extends StackProps {
  prefix: string;
  parameterHelper: ParameterHelper;
}

export class VpcStack extends Stack {
  public readonly vpc: Vpc;
  public readonly dbListenerSecurityGroup: ec2.SecurityGroup;
  public readonly databaseClient: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkingStackProps) {
    super(scope, id, props);

    // Store VPC CIDR block
    // Use a fixed CIDR block value that matches what we define in the VPC
    const vpcCidr = "10.0.0.0/16"; // This should match the default CIDR used by CDK
    const port = 5432;

    this.vpc = new Vpc(this, "vpc", {
      maxAzs: 2,
      vpcName: `${props.prefix}-vpc`,
      natGateways: 1,
      cidr: vpcCidr, // Explicitly set the CIDR block
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public",
          subnetType: SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "private",
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: "isolated",
          subnetType: SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    const subnetPublicParamList = this.vpc.publicSubnets.map(
      (subnet) => subnet.subnetId
    );

    const subnetIsolatedParamList = this.vpc.isolatedSubnets.map(
      (subnet) => subnet.subnetId
    );

    const subnetPrivateParamList = this.vpc.privateSubnets.map(
      (subnet) => subnet.subnetId
    );

    // Create a security group for the database
    this.dbListenerSecurityGroup = new ec2.SecurityGroup(
      this,
      "DBSecurityGroup",
      {
        vpc: this.vpc,
        securityGroupName: `${props.prefix}-database-listener-sg`,
        description: `Security group for ${props.prefix} Allow rds access to RDS instances`,
        allowAllOutbound: true,
      }
    );

    // Create Database Client Security Group
    this.databaseClient = new ec2.SecurityGroup(this, "database-client-sg", {
      vpc: this.vpc,
      securityGroupName: `${props.prefix}-database-client-sg`,
      description: "Allow clients access to RDS instances",
      allowAllOutbound: true,
    });

    // Allow connection from the database client
    this.dbListenerSecurityGroup.connections.allowFrom(
      new ec2.Connections({
        securityGroups: [this.databaseClient],
      }),
      ec2.Port.tcp(port),
      "Allow connections from the clients for Postgres"
    );

    // Allow connection from the database client
    this.dbListenerSecurityGroup.connections.allowFrom(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(port),
      "Allow connections from VPC CIDR"
    );

    new ssm.StringParameter(this, "ExportVpcId", {
      parameterName: props.parameterHelper.vpcId(),
      description: "Vpc IDs",
      stringValue: this.vpc.vpcId,
    });

    new ssm.StringListParameter(this, "ExportVpcAZs", {
      parameterName: props.parameterHelper.vpcAvaibilityZonesParameterName(),
      stringListValue: this.vpc.availabilityZones,
      description: "Availability Zones",
    });

    new ssm.StringListParameter(this, "ExportVpcPublicSubnetsIds", {
      parameterName: props.parameterHelper.vpcSubnetsIdParameterName(),
      description: "Public Subnets IDs",
      stringListValue: subnetPublicParamList,
    });

    new ssm.StringListParameter(this, "ExportVpcIsolatedSubnetsIds", {
      parameterName: props.parameterHelper.vpcIsolatedSubnetsIdParameterName(),
      description: "Isolated Subnets IDs",
      stringListValue: subnetIsolatedParamList,
    });

    new ssm.StringListParameter(this, "ExportVpcPrivateSubnetsIds", {
      parameterName: props.parameterHelper.vpcPrivateSubnetsIdParameterName(),
      description: "Private Subnets IDs",
      stringListValue: subnetPrivateParamList,
    });

    // Store VPC CIDR block
    new ssm.StringParameter(this, "ExportVpcCidrBlock", {
      parameterName: props.parameterHelper.vpcCidrBlockParameterName(),
      description: "VPC CIDR Block",
      stringValue: vpcCidr, // Use the fixed value
    });

    new ssm.StringParameter(this, "DBListenerSecurityGroupIdParameter", {
      parameterName:
        props.parameterHelper.dbListenerSecurityGroupIdParameterName(),
      stringValue: this.dbListenerSecurityGroup.securityGroupId,
    });

    new ssm.StringParameter(this, "DBClientSecurityGroupIdParameter", {
      parameterName:
        props.parameterHelper.dbClientSecurityGroupIdParameterName(),
      stringValue: this.databaseClient.securityGroupId,
    });
  }
}
