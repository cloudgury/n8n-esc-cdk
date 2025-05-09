import { Stack, StackProps, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as fs from "fs";
import * as path from "path";
import { KeyPair } from "cdk-ec2-key-pair";
import { ParameterHelper } from "@/utils/parameter-helper";
import { IVpc, SecurityGroup, ISecurityGroup } from "aws-cdk-lib/aws-ec2";

interface BastionServerStackProps extends StackProps {
  readonly prefix: string;
  readonly parameterHelper: ParameterHelper;
  readonly vpc: IVpc;
}

export class BastionServerStack extends Stack {
  private keyPair: KeyPair;
  private bastionHost: ec2.Instance;
  public readonly vpc: IVpc;

  constructor(scope: Construct, id: string, props: BastionServerStackProps) {
    super(scope, id, props);

    this.vpc = props.vpc;

    this.keyPair = new KeyPair(this, `${props.prefix}-bastion-host-key-pair`, {
      keyPairName: `${props.prefix}-bastion-host-key-pair`,
      secretPrefix: props.parameterHelper.bastionHostSshKeyParameterName(),
      description: `${props.prefix}-Key pair for bastion host`,
    });


    const efsClientSecurityGroupId = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.efsClientSecurityGroupIdParameterName()
    );

    const dbClientSecurityGroupId = ssm.StringParameter.valueFromLookup(
      this,
      props.parameterHelper.dbClientSecurityGroupIdParameterName()
    );
    // Import EFS security group
    const efsClientSecurityGroup = SecurityGroup.fromSecurityGroupId(
      this,
      "ImportedEfsSecurityGroup",
      efsClientSecurityGroupId
    ) as ISecurityGroup;

    const dbClientSecurityGroup = SecurityGroup.fromSecurityGroupId(
      this,
      "ImportedDbSecurityGroup",
      dbClientSecurityGroupId
    ) as ISecurityGroup;

    const scriptPath = path.join(__dirname, "..", "scripts", "init.sh");
    const scriptContents = fs.readFileSync(scriptPath, "utf8");

    const InstanceuserData = ec2.UserData.forLinux();
    InstanceuserData.addCommands(scriptContents);

    this.bastionHost = new ec2.Instance(this, "BastionHost", {
      instanceName: `${props.prefix}-bastion-host`,
      instanceType: new ec2.InstanceType("t3.micro"),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023,
      }),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: efsClientSecurityGroup,
      requireImdsv2: true,
      associatePublicIpAddress: true,
      userDataCausesReplacement: true,
      blockDevices: [
        {
          deviceName: "/dev/xvdb",
          volume: ec2.BlockDeviceVolume.ebs(50, { encrypted: true }),
          mappingEnabled: true,
        },
      ],
      userData: InstanceuserData,
    });

    this.bastionHost.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );

    const kmsInlinePolicy = new iam.Policy(this, "kms-policy", {
      statements: [
        new iam.PolicyStatement({
          actions: [
            "kms:Encrypt",
            "kms:Decrypt",
            "kms:ReEncrypt*",
            "kms:GenerateDataKey*",
            "kms:DescribeKey",
            "secretsmanager:GetSecretValue",
          ],
          resources: ["*"],
        }),
      ],
    });

    const s3InlinePolicy = new iam.Policy(this, "s3-policy", {
      statements: [
        new iam.PolicyStatement({
          actions: [
            "s3:GetObject",
            "s3:PutObject",
            "s3:ListBucket",
            "s3:ListAllMyBuckets",
          ],
          resources: ["*"],
        }),
      ],
    });

    const assumeInlinePolicy = new iam.Policy(this, "assume-policy", {
      statements: [
        new iam.PolicyStatement({
          actions: ["sts:AssumeRole"],
          resources: ["*"],
        }),
      ],
    });

    const ssmHost = new iam.Policy(this, "ssm-policy", {
      statements: [
        new iam.PolicyStatement({
          actions: [
            "ec2messages:*",
            "ssm:UpdateInstanceInformation",
            "ssmmessages:*",
          ],
          resources: ["*"],
        }),
      ],
    });

    const efsPolicy = new iam.Policy(this, "ssm-efs", {
      statements: [
        new iam.PolicyStatement({
          actions: [
            "elasticfilesystem:ClientMount",
            "elasticfilesystem:ClientWrite",
            "elasticfilesystem:ClientRootAccess",
            "elasticfilesystem:DescribeMountTargets",
            "elasticfilesystem:DescribeFileSystems",
          ],
          resources: ["*"],
        }),
      ],
    });

    this.bastionHost.role.attachInlinePolicy(kmsInlinePolicy);
    this.bastionHost.role.attachInlinePolicy(s3InlinePolicy);
    this.bastionHost.role.attachInlinePolicy(assumeInlinePolicy);
    this.bastionHost.role.attachInlinePolicy(ssmHost);
    this.bastionHost.role.attachInlinePolicy(efsPolicy);
    this.bastionHost.instance.addPropertyOverride(
      "KeyName",
      this.keyPair.keyPairName
    );

    new ssm.StringParameter(this, "BastionInstanceId", {
      parameterName: props.parameterHelper.bastionHostInstanceIdParameterName(),
      stringValue: this.bastionHost.instanceId,
      description: "Bastion host instance id",
    });

    // Add additional security group
    this.bastionHost.addSecurityGroup(dbClientSecurityGroup);
  }
}
