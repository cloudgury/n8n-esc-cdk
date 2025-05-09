#!/usr/bin/env node
import { App, Tags, Environment } from "aws-cdk-lib";
import { VpcStack } from "../lib/vpc-stack";
import { EfsStack } from "../lib/efs-stack";
import { EcsClusterStack } from "../lib/ecs-cluster-stack";
import { RdsStack } from "../lib/rds-stack";
import { ParameterHelper } from "@/utils/parameter-helper";
import { capitalize, logMessage, logConfig } from "@/utils/strings";
import { BastionServerStack } from "../lib/bastion-stack";
import { N8nDatabaseStack } from "../lib/n8n-database-stack";
import { N8nRedisStack } from "../lib/n8n-redis-stack";
import { N8nServiceStack } from "../lib/n8n-service-stack";

const app = new App();

// Get the environment from the context
const appEnvironment = app.node.tryGetContext("environment");
if (!appEnvironment) {
  throw new Error("App environment must be specified in context");
}

const account = app.node.tryGetContext("account");
const region = app.node.tryGetContext("region");
const Createrds = app.node.tryGetContext("rdsCreate") === "true";
console.log("Account:", account, "Region:", region, "Create RDS:", Createrds);
const env = { account, region };

const parameterHelper = new ParameterHelper("n8n", appEnvironment);

const stackName = `${capitalize("n8n")}${capitalize(appEnvironment)}`;

const netStack = new VpcStack(app, `${stackName}NetworkStack`, {
  prefix: `n8n-${appEnvironment}`,
  parameterHelper: parameterHelper,
  env: env,
});
// Create EFS stack
const efsStack = new EfsStack(app, `${stackName}EfsStack`, {
  vpc: netStack.vpc,
  parameterHelper: parameterHelper,
  env: env,
});
efsStack.addDependency(netStack);

// Add RDS PostgreSQL stack only if enabled in context
let rdsStack;
if (Createrds) {
  rdsStack = new RdsStack(app, `${stackName}RdsStack`, {
    parameterHelper: parameterHelper,
    databaseName: "n8n",
    env: env,
  });
  rdsStack.addDependency(netStack);
}

// Create ECS cluster stack
const ecsClusterStack = new EcsClusterStack(
  app,
  `${stackName}EcsClusterStack`,
  {
    parameterHelper: parameterHelper,
    env: env,
  }
);
ecsClusterStack.addDependency(netStack);
ecsClusterStack.addDependency(efsStack);

// // Create Bastion Host stack
const bastionHostStack = new BastionServerStack(
  app,
  `${stackName}BastionHostStack`,
  {
    prefix: `n8n-${appEnvironment}`,
    parameterHelper: parameterHelper,
    vpc: netStack.vpc,
    env: env,
  }
);
bastionHostStack.addDependency(netStack);

// Create the database stack
const databaseStack = new N8nDatabaseStack(
  app,
  `${stackName}ServiceDatabaseStack`,
  {
    parameterHelper,
    prefix: `n8n-${appEnvironment}`,
    vpc: netStack.vpc,
    env: env,
  }
);
databaseStack.addDependency(ecsClusterStack);

//
if (rdsStack) {
  databaseStack.addDependency(rdsStack);
}

// Create the Redis stack
const redisStack = new N8nRedisStack(app, `${stackName}ServiceRedisStack`, {
  parameterHelper,
  prefix: `n8n-${appEnvironment}`,
  vpc: netStack.vpc,
  env: env,
});
redisStack.addDependency(ecsClusterStack);

const serviceStack = new N8nServiceStack(app, `${stackName}N8NServiceStack`, {
  prefix: `n8n-${appEnvironment}`,
  parameterHelper,
  vpc: netStack.vpc,
  env: env,
});
serviceStack.addDependency(databaseStack);
serviceStack.addDependency(redisStack);
