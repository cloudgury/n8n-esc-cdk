import {
  StackProps,
  Stack,
  RemovalPolicy,
  aws_ssm as ssm,
  aws_ec2 as ec2,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  Cluster,
  ExecuteCommandLogConfiguration,
  ExecuteCommandLogging,
} from "aws-cdk-lib/aws-ecs";
import { IVpc } from "aws-cdk-lib/aws-ec2";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { PrivateDnsNamespace } from "aws-cdk-lib/aws-servicediscovery";
import { ParameterHelper } from "@/utils/parameter-helper";

export interface EcsClusterStackProps extends StackProps {
  parameterHelper: ParameterHelper;
}

export class EcsClusterStack extends Stack {
  public readonly vpc: IVpc;
  public readonly cluster: Cluster;
  public readonly namespace: PrivateDnsNamespace;

  constructor(scope: Construct, id: string, props: EcsClusterStackProps) {
    super(scope, id, props);

    // Import VPC from SSM parameters
    const vpcId = ssm.StringParameter.valueForStringParameter(
      this,
      props.parameterHelper.vpcId()
    );

    // Get subnet IDs from SSM parameters
    const isolatedSubnetsIds =
      ssm.StringListParameter.valueForTypedListParameter(
        this,
        props.parameterHelper.vpcIsolatedSubnetsIdParameterName()
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

    const availabilityZones =
      ssm.StringListParameter.valueForTypedListParameter(
        this,
        props.parameterHelper.vpcAvaibilityZonesParameterName()
      );

    // Import VPC
    this.vpc = ec2.Vpc.fromVpcAttributes(this, "VpcImport", {
      vpcId: vpcId,
      availabilityZones: availabilityZones,
      isolatedSubnetIds: isolatedSubnetsIds,
      publicSubnetIds: publicSubnetsIds,
      privateSubnetIds: privateSubnetsIds,
    });

    // Create log group for ECS Exec logs
    const execLogGroup = new LogGroup(this, "EcsExecLogGroup", {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    let env = "stg";
    // Create ECS Cluster
    this.cluster = new Cluster(this, "N8NEcsCluster", {
      vpc: this.vpc,
      executeCommandConfiguration: {
        logging: ExecuteCommandLogging.OVERRIDE,
        logConfiguration: {
          cloudWatchLogGroup: execLogGroup,
        },
      },
      clusterName: `n8n-${env}-workflow-cluster`,
    });

    // Create service discovery namespace for internal service communication
    let namespaceName = "n8n-stg.internal";

    this.namespace = new PrivateDnsNamespace(
      this,
      "ServiceDiscoveryNamespace",
      {
        name: namespaceName,
        vpc: this.vpc,
        description: "Private namespace for n8n services",
      }
    );

    // Store cluster name in SSM
    new ssm.StringParameter(this, "ClusterNameParam", {
      parameterName: props.parameterHelper.ecsClusterName(),
      stringValue: this.cluster.clusterName,
      description: "ECS Cluster Name",
    });

    // Store Service Discovery Namespace information
    new ssm.StringParameter(this, "NamespaceIdParam", {
      parameterName: props.parameterHelper.namespaceIdParameterName(),
      stringValue: this.namespace.namespaceId,
      description: "Service Discovery Namespace ID",
    });

    new ssm.StringParameter(this, "NamespaceNameParam", {
      parameterName: props.parameterHelper.namespaceNameParameterName(),
      stringValue: this.namespace.namespaceName,
      description: "Service Discovery Namespace Name",
    });

    new ssm.StringParameter(this, "NamespaceArnParam", {
      parameterName: props.parameterHelper.namespaceArnParameterName(),
      stringValue: this.namespace.namespaceArn,
      description: "Service Discovery Namespace ARN",
    });
  }
}
