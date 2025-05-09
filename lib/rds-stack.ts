import {
  aws_ec2 as ec2,
  aws_rds,
  RemovalPolicy,
  Stack,
  StackProps,
  CfnOutput,
  aws_ssm as ssm,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { ParameterHelper } from "../utils/parameter-helper";

interface RdsStackProps extends StackProps {
  parameterHelper: ParameterHelper;
  databaseName?: string;
  username?: string;
}

export class RdsStack extends Stack {
  public readonly dbInstance: aws_rds.DatabaseInstance;
  public readonly dbSecret: aws_rds.DatabaseSecret;
  // public readonly dbListenerSecurityGroup: ec2.SecurityGroup;
  // public readonly databaseClient: ec2.SecurityGroup;
  constructor(scope: Construct, id: string, props: RdsStackProps) {
    super(scope, id, props);

    const databaseName = props.databaseName || "n8n";
    const username = props.username || "n8n";

    const port = 5432;

    // Import VPC from parameters
    const vpcId = ssm.StringParameter.valueForStringParameter(
      this,
      props.parameterHelper.vpcId()
    );
    const rdsListenerSecurityGroupId = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.dbListenerSecurityGroupIdParameterName()
    );

    // Import DB listener security group
    const dbListenerSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      "ImportedDbListenerSecurityGroup",
      rdsListenerSecurityGroupId
    );

    const availabilityZones =
      ssm.StringListParameter.valueForTypedListParameter(
        this,
        props.parameterHelper.vpcAvaibilityZonesParameterName()
      );

    const publicSubnetsIds = ssm.StringListParameter.valueForTypedListParameter(
      this,
      props.parameterHelper.vpcSubnetsIdParameterName()
    );

    const privateSubnetsIds =
      ssm.StringListParameter.valueForTypedListParameter(
        this,
        props.parameterHelper.vpcPrivateSubnetsIdParameterName()
      );

    // Get VPC CIDR block from SSM parameter
    const vpcCidrBlock = ssm.StringParameter.valueForStringParameter(
      this,
      props.parameterHelper.vpcCidrBlockParameterName()
    );

    const vpc = ec2.Vpc.fromVpcAttributes(this, "VpcImport", {
      vpcId: vpcId,
      availabilityZones: availabilityZones,
      publicSubnetIds: publicSubnetsIds,
      privateSubnetIds: privateSubnetsIds,
      vpcCidrBlock: vpcCidrBlock,
    });

    // Create a database secret
    this.dbSecret = new aws_rds.DatabaseSecret(this, "DBSecret", {
      username,
      secretName: `${databaseName}DatabaseSecret`,
    });

    // // Create a security group for the database
    // this.dbListenerSecurityGroup = new ec2.SecurityGroup(
    //   this,
    //   "DBSecurityGroup",
    //   {
    //     vpc,
    //     securityGroupName: `${databaseName}-database-listener-sg`,
    //     description: `Security group for ${databaseName} Allow rds access to RDS instances`,
    //     allowAllOutbound: true,
    //   }
    // );

    // // Create Database Client Security Group
    // this.databaseClient = new ec2.SecurityGroup(this, "database-client-sg", {
    //   vpc,
    //   securityGroupName: `${databaseName}-database-client-sg`,
    //   description: "Allow clients access to RDS instances",
    //   allowAllOutbound: true,
    // });

    // Allow connection from the database client
    // this.dbListenerSecurityGroup.connections.allowFrom(
    //   new ec2.Connections({
    //     securityGroups: [this.databaseClient],
    //   }),
    //   ec2.Port.tcp(port),
    //   "Allow connections from the clients for Postgres"
    // );

    // // Allow connection from the database client
    // this.dbListenerSecurityGroup.connections.allowFrom(
    //   ec2.Peer.ipv4(vpc.vpcCidrBlock),
    //   ec2.Port.tcp(port),
    //   "Allow connections from VPC CIDR"
    // );

    // Create the RDS instance
    this.dbInstance = new aws_rds.DatabaseInstance(this, "Instance", {
      databaseName,
      instanceIdentifier: databaseName,
      vpc,
      vpcSubnets: {
        onePerAz: true,
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [dbListenerSecurityGroup],
      engine: aws_rds.DatabaseInstanceEngine.postgres({
        version: aws_rds.PostgresEngineVersion.VER_15_9,
      }),
      credentials: aws_rds.Credentials.fromSecret(this.dbSecret),
      removalPolicy: RemovalPolicy.DESTROY,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE3,
        ec2.InstanceSize.SMALL
      ),
    });

    // Store database parameters in SSM Parameter Store
    new ssm.StringParameter(this, "DBEndpointAddressParameter", {
      parameterName: props.parameterHelper.dbEndpointAddressParameterName(),
      stringValue: this.dbInstance.dbInstanceEndpointAddress,
    });

    new ssm.StringParameter(this, "DBEndpointPortParameter", {
      parameterName: props.parameterHelper.dbEndpointPortParameterName(),
      stringValue: this.dbInstance.dbInstanceEndpointPort,
    });

    new ssm.StringParameter(this, "DBSecretArnParameter", {
      parameterName: props.parameterHelper.dbSecretArnParameterName(),
      stringValue: this.dbSecret.secretArn,
    });

    // new ssm.StringParameter(this, "DBListenerSecurityGroupIdParameter", {
    //   parameterName:
    //     props.parameterHelper.dbListenerSecurityGroupIdParameterName(),
    //   stringValue: this.dbListenerSecurityGroup.securityGroupId,
    // });

    // new ssm.StringParameter(this, "DBClientSecurityGroupIdParameter", {
    //   parameterName:
    //     props.parameterHelper.dbClientSecurityGroupIdParameterName(),
    //   stringValue: this.databaseClient.securityGroupId,
    // });

    new ssm.StringParameter(this, "DBNameParameter", {
      parameterName: props.parameterHelper.dbNameParameterName(),
      stringValue: databaseName,
    });

    new ssm.StringParameter(this, "DBUsernameParameter", {
      parameterName: props.parameterHelper.dbUsernameParameterName(),
      stringValue: username,
    });

    // Outputs
    new CfnOutput(this, "DatabaseEndpointAddress", {
      value: this.dbInstance.dbInstanceEndpointAddress,
      exportName: `${databaseName}EndpointAddress`,
    });

    new CfnOutput(this, "DatabaseEndpointPort", {
      value: this.dbInstance.dbInstanceEndpointPort,
      exportName: `${databaseName}EndpointPort`,
    });

    // new CfnOutput(this, "DatabaseListenerSecurityGroupId", {
    //   value: this.dbListenerSecurityGroup.securityGroupId,
    //   exportName: `${databaseName}ListenerSecurityGroupId`,
    // });
  }
}
