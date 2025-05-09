export class ParameterHelper {
  getRdsEnabled() {
    throw new Error("Method not implemented.");
  }
  private readonly appName: string;
  private envName: string;

  constructor(appName: string, envName: string) {
    this.appName = appName;
    this.envName = envName;
  }

  private _rootPrefixV2(): string {
    return `/${
      this.appName.charAt(0).toLowerCase() + this.appName.slice(1).toLowerCase()
    }/${
      this.envName.charAt(0).toLowerCase() + this.envName.slice(1).toLowerCase()
    }`;
  }

  vpcId(): string {
    return `${this._rootPrefixV2()}/Vpc/Id`;
  }

  efsIdParameterName(): string {
    return `${this._rootPrefixV2()}/Efs/Id`;
  }

  efsAccessPointIdParameterName(): string {
    return `${this._rootPrefixV2()}/Efs/AccessPointId`;
  }

  postgresAccessPointIdParameterName(): string {
    return `${this._rootPrefixV2()}/Efs/PostgresAccessPointId`;
  }

  redisAccessPointIdParameterName(): string {
    return `${this._rootPrefixV2()}/Efs/RedisAccessPointId`;
  }

  vpcSubnetsIdParameterName(): string {
    return `${this._rootPrefixV2()}/Vpc/SubnetsId`;
  }

  vpcIsolatedSubnetsIdParameterName(): string {
    return `${this._rootPrefixV2()}/Vpc/IsolatedSubnetsId`;
  }

  vpcPrivateSubnetsIdParameterName(): string {
    return `${this._rootPrefixV2()}/Vpc/PrivateSubnetsId`;
  }

  vpcAvaibilityZonesParameterName(): string {
    return `${this._rootPrefixV2()}/Vpc/AvalabilityZones`;
  }

  efsListenerSecurityGroupIdParameterName(): string {
    return `${this._rootPrefixV2()}/Efs/ListenerSecurityGroupId`;
  }

  efsClientSecurityGroupIdParameterName(): string {
    return `${this._rootPrefixV2()}/Efs/ClientSecurityGroupId`;
  }

  // Database parameter methods
  dbEndpointAddressParameterName(): string {
    return `${this._rootPrefixV2()}/Database/EndpointAddress`;
  }

  dbEndpointPortParameterName(): string {
    return `${this._rootPrefixV2()}/Database/EndpointPort`;
  }

  dbSecretArnParameterName(): string {
    return `${this._rootPrefixV2()}/Database/SecretArn`;
  }

  dbListenerSecurityGroupIdParameterName(): string {
    return `${this._rootPrefixV2()}/Database/ListenerSecurityGroupId`;
  }

  dbClientSecurityGroupIdParameterName(): string {
    return `${this._rootPrefixV2()}/Database/ClientSecurityGroupId`;
  }

  dbNameParameterName(): string {
    return `${this._rootPrefixV2()}/Database/Name`;
  }

  dbUsernameParameterName(): string {
    return `${this._rootPrefixV2()}/Database/Username`;
  }

  // Added methods for N8nStack
  ecsClusterName(): string {
    const paramPath = `${this._rootPrefixV2()}/Ecs/ClusterName`;
    return paramPath;
  }

  efsId(): string {
    return this.efsIdParameterName();
  }

  efsAccessPointId(): string {
    return this.efsAccessPointIdParameterName();
  }

  n8nAccessPointId(): string {
    const paramPath = `${this._rootPrefixV2()}/Efs/N8nAccessPointId`;
    return paramPath;
  }

  // PostgreSQL connection parameters for N8n stacks used by container
  postgresHost(): string {
    return `${this._rootPrefixV2()}/PostgreSQL/Host`;
  }

  postgresPort(): string {
    return `${this._rootPrefixV2()}/PostgreSQL/Port`;
  }

  postgresRootUsername(): string {
    return `${this._rootPrefixV2()}/PostgreSQL/Username`;
  }

  postgresRootPassword(): string {
    return `${this._rootPrefixV2()}/PostgreSQL/Password`;
  }

  postgresN8nDatabase(): string {
    return `${this._rootPrefixV2()}/PostgreSQL/N8nDatabase`;
  }

  postgresNonRootUser(): string {
    return `${this._rootPrefixV2()}/PostgreSQL/NonRootUser`;
  }

  postgresNonRootPassword(): string {
    return `${this._rootPrefixV2()}/PostgreSQL/NonRootPassword`;
  }

  postgresAdminSecretArn(): string {
    return `${this._rootPrefixV2()}/PostgreSQL/AdminSecretArn`;
  }

  postgresAppSecretArn(): string {
    return `${this._rootPrefixV2()}/PostgreSQL/AppSecretArn`;
  }
  postgresAdminSecretName(): string {
    return `${this._rootPrefixV2()}/PostgreSQL/AdminSecretName`;
  }

  postgresAppSecretName(): string {
    return `${this._rootPrefixV2()}/PostgreSQL/AppSecretName`;
  }

  // Redis connection parameters for N8n stacks
  redisHost(): string {
    return `${this._rootPrefixV2()}/Redis/Host`;
  }

  redisPort(): string {
    return `${this._rootPrefixV2()}/Redis/Port`;
  }

  redisPassword(): string {
    return `${this._rootPrefixV2()}/Redis/Password`;
  }

  redisPasswordSecretName(): string {
    return `${this._rootPrefixV2()}/Redis/PasswordSecretName`;
  }

  redisPasswordSecretArn(): string {
    return `${this._rootPrefixV2()}/Redis/PasswordSecretArn`;
  }

  // Service Discovery Namespace parameters
  namespaceIdParameterName(): string {
    return `${this._rootPrefixV2()}/ServiceDiscovery/NamespaceId`;
  }

  namespaceNameParameterName(): string {
    return `${this._rootPrefixV2()}/ServiceDiscovery/NamespaceName`;
  }

  namespaceArnParameterName(): string {
    return `${this._rootPrefixV2()}/ServiceDiscovery/NamespaceArn`;
  }

  vpcCidrBlockParameterName(): string {
    return `${this._rootPrefixV2()}/Vpc/CidrBlock`;
  }

  bastionHostInstanceSshSecurityGroupIdParameterName(): string {
    return `${this._rootPrefixV2()}/BastionHost/instance/securityGroup/id`;
  }

  bastionHostInstanceIdParameterName(): string {
    return `${this._rootPrefixV2()}/BastionHost/instance/id`;
  }
  bastionHostSshKeyParameterName(): string {
    return `${this._rootPrefixV2()}/BastionHost/ssh/key`;
  }
}
