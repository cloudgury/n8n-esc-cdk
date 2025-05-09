# n8n CDK Project

This project deploys n8n workflow automation platform on AWS using the CDK (Cloud Development Kit). The solution is a POC to show the ability to deploy the
self-hosted environment in AWS using ECS cluster.
Disclaimer: _Not production ready_

## Architecture

The infrastructure consists of:

- VPC with public, private, and isolated subnets across 2 AZs
- ECS Fargate for running containerized services
- EFS for persistent storage
- PostgreSQL database running in a container
- Redis for queuing
- Application Load Balancer for accessing the n8n UI
- Bastion host for administrative access

![Architecture Diagram](architecture-diagram.png)

For a detailed diagram in Mermaid format, see [architecture-diagram.md](architecture-diagram.md)

## Useful commands

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npm run test` perform the jest unit tests
- `npx cdk deploy` deploy this stack to your default AWS account/region
- `npx cdk diff` compare deployed stack with current state
- `npx cdk synth` emits the synthesized CloudFormation template

## Local Docker Setup

For local development, you can use the Docker Compose configuration to run the N8N locally:
Navigate to the docker-local directory

```bash
docker-compose up -d
```

Access n8n in your browser at: http://localhost:5678

## Pre-Requirements

Bootstrap AWS account for CDK `cdk bootstrap`

## Deploy the infrastructure

- List stacks `cdk -c environment=dev ls`
  Here is the list of stacks to deploy in this order

````
 1.N8nDevNetworkStack
 2.N8nDevEfsStack
  - N8nDevRdsStack - *Optinal need to modify the cdk.context.json rdsCreate set to true and modify the N8nDevN8NServiceStack  envs to use RDS*
 3.N8nDevEcsClusterStack
 4.N8nDevBastionHostStack
 6.N8nDevServiceDatabaseStack
  **Note** : Before deploying the N8NService we need to excute the db-init script that will cretea a n8n database and application user that is used by the app. Please navigate to /scrips/and excecute `./connect-db-container.sh`  this script that will login to the  datbase container  after that navigate to /scrips/ and run this script   `init-postgres.sh`
   ```root@ip-10-0-3-219:/scripts# ls -la
   drwxr-xr-x 2 root root 4096 May  8 00:20 .
   drwxr-xr-x 1 root root 4096 May  8 00:19 ..
   -rwxr-xr-x 1 root root 3718 May  7 23:41 init-postgres.sh
   root@ip-10-0-3-219:/scripts# ```

 7.N8nDevServiceRedisStack
 8.N8nDevN8NServiceStack
````

- Deploy stack `cdk -c environment=dev deploy N8nDevNetworkStack`
- Diff the stack `cdk -c environment=dev diff N8nDevNetworkStack`
- Delete the stack `cdk -c environment=dev destroy N8nDevNetworkStack`

## AWS Infrastructure Cost Analysis

### AWS Resources Used

#### 1. VPC and Networking

- VPC with 2 Availability Zones
- NAT Gateway (1)
- Public, Private, and Isolated Subnets
- Internet Gateway

#### 2. EFS (Elastic File System)

- File system with access points for:
  - PostgreSQL data
  - Redis data
  - n8n data

#### 3. ECS (Elastic Container Service)

- ECS Cluster
- Fargate Services for:
  - PostgreSQL database container
  - Redis container
  - n8n main service
  - n8n worker service

#### 4. Application Load Balancer

- Internet-facing ALB for n8n service

#### 5. EC2 Bastion Host

- t3.micro instance with 50GB EBS volume

#### 6. CloudWatch Logs

- Log groups for all services

#### 7. Service Discovery (AWS Cloud Map)

- Private DNS namespace for internal service communication

#### 8. Secrets Manager

- For storing n8n encryption key

### Estimated Monthly Cost Breakdown

#### 1. VPC and Networking

- NAT Gateway: ~$32/month + data processing charges
- VPC Endpoints: Free for gateway endpoints, ~$7.30/month per interface endpoint

#### 2. EFS (Elastic File System)

- Standard Storage: ~$0.30/GB-month
- Assuming 20GB of storage: ~$6/month

#### 3. ECS (Fargate)

- Fargate Tasks:
  - PostgreSQL (1 vCPU, 2GB memory): ~$37/month
  - Redis (0.5 vCPU, 1GB memory): ~$18.50/month
  - n8n main service (1 vCPU, 2GB memory): ~$37/month
  - n8n worker service (1 vCPU, 2GB memory): ~$37/month
  - Total Fargate: ~$129.50/month

#### 4. Application Load Balancer

- ALB: ~$16.20/month + data processing charges

#### 5. EC2 Bastion Host

- t3.micro: ~$8.50/month
- EBS Volume (50GB): ~$5/month
- Total Bastion: ~$13.50/month

#### 6. CloudWatch Logs

- Log storage and ingestion: ~$5-10/month (depends on log volume)

#### 7. Service Discovery (AWS Cloud Map)

- Service Discovery: ~$1/month per namespace + $0.10/month per registered instance
- Total Cloud Map: ~$1.40/month

#### 8. Secrets Manager

- Secrets: ~$0.40/month per secret
- Total Secrets Manager: ~$0.40/month

### Total Estimated Monthly Cost

- Base Infrastructure: ~$208/month
- Data Transfer: Additional costs based on usage
- Storage Growth: Additional costs as EFS storage grows

### Cost Optimization Recommendations

1. **NAT Gateway**: Consider using NAT instances instead of NAT Gateway for dev environments to save ~$30/month.

2. **Fargate Sizing**: The current configuration uses separate Fargate tasks for each service. For lower workloads, you could:

   - Reduce CPU/memory allocations
   - Use Fargate Spot for the worker service to save up to 70% on that component

3. **Bastion Host**: Consider using AWS Systems Manager Session Manager instead of a permanent bastion host to save ~$13.50/month.

4. **EFS**: Monitor usage and consider using lifecycle policies to move infrequently accessed data to lower-cost storage tiers.

5. **Auto Scaling**: Implement auto-scaling for the n8n services based on demand to optimize costs during low-usage periods.

Note: These are estimates based on the code review, and actual costs will depend on your specific usage patterns, data transfer volumes, and AWS region. For a more precise estimate based on your expected usage, use the [AWS Pricing Calculator](https://calculator.aws).

## Security

For production use, consider:

- Changing the default encryption key
- Setting up proper authentication
- Using HTTPS instead of HTTP
- Implementing more restrictive security groups
- Adding WAF to the ALB
