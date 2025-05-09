```mermaid
graph TD
    %% Define Internet and User
    Internet((Internet))
    User((User))
    
    %% Define AWS Cloud boundary
    subgraph AWS["AWS Cloud"]
        %% VPC with AZs
        subgraph VPC["VPC"]
            %% AZ1
            subgraph AZ1["Availability Zone 1"]
                %% Subnets in AZ1
                PublicSubnet1["Public Subnet"]
                PrivateSubnet1["Private Subnet"]
                IsolatedSubnet1["Isolated Subnet"]
                
                %% Resources in AZ1
                BastionHost["Bastion Host\nt3.micro"]
                NAT["NAT Gateway"]
            end
            
            %% AZ2
            subgraph AZ2["Availability Zone 2"]
                %% Subnets in AZ2
                PublicSubnet2["Public Subnet"]
                PrivateSubnet2["Private Subnet"]
                IsolatedSubnet2["Isolated Subnet"]
            end
            
            %% Shared Resources
            ALB["Application Load Balancer"]
            IGW["Internet Gateway"]
            
            %% ECS Cluster
            subgraph ECSCluster["ECS Cluster (Fargate)"]
                N8nMain["n8n Main Service\n1 vCPU, 2GB RAM"]
                N8nWorker["n8n Worker Service\n1 vCPU, 2GB RAM"]
                PostgreSQL["PostgreSQL\n1 vCPU, 2GB RAM"]
                Redis["Redis\n0.5 vCPU, 1GB RAM"]
            end
            
            %% EFS
            subgraph EFS["Elastic File System"]
                N8nData["n8n Data"]
                PostgreSQLData["PostgreSQL Data"]
                RedisData["Redis Data"]
            end
            
            %% Service Discovery
            ServiceDiscovery["AWS Cloud Map\nService Discovery"]
            
            %% Secrets Manager
            SecretsManager["Secrets Manager\nn8n Encryption Key"]
            
            %% CloudWatch
            CloudWatch["CloudWatch Logs"]
        end
    end
    
    %% Define connections
    Internet -- HTTPS --> IGW
    User -- Access n8n UI --> Internet
    IGW -- Traffic --> ALB
    IGW -- Traffic --> PublicSubnet1
    IGW -- Traffic --> PublicSubnet2
    
    PublicSubnet1 -- Traffic --> NAT
    NAT -- Traffic --> PrivateSubnet1
    NAT -- Traffic --> PrivateSubnet2
    
    PublicSubnet1 -- Hosts --> BastionHost
    PublicSubnet1 -- Hosts --> ALB
    PublicSubnet2 -- Hosts --> ALB
    
    ALB -- Routes Traffic --> N8nMain
    
    PrivateSubnet1 -- Hosts --> N8nMain
    PrivateSubnet1 -- Hosts --> N8nWorker
    PrivateSubnet2 -- Hosts --> N8nMain
    PrivateSubnet2 -- Hosts --> N8nWorker
    
    IsolatedSubnet1 -- Hosts --> PostgreSQL
    IsolatedSubnet1 -- Hosts --> Redis
    IsolatedSubnet2 -- Hosts --> PostgreSQL
    IsolatedSubnet2 -- Hosts --> Redis
    
    N8nMain -- Mounts --> N8nData
    N8nWorker -- Mounts --> N8nData
    PostgreSQL -- Mounts --> PostgreSQLData
    Redis -- Mounts --> RedisData
    
    N8nMain -- Discovers --> ServiceDiscovery
    N8nWorker -- Discovers --> ServiceDiscovery
    PostgreSQL -- Registers With --> ServiceDiscovery
    Redis -- Registers With --> ServiceDiscovery
    
    N8nMain -- Uses --> SecretsManager
    N8nWorker -- Uses --> SecretsManager
    
    N8nMain -- Logs To --> CloudWatch
    N8nWorker -- Logs To --> CloudWatch
    PostgreSQL -- Logs To --> CloudWatch
    Redis -- Logs To --> CloudWatch
    
    N8nMain -- Connects To --> PostgreSQL
    N8nMain -- Connects To --> Redis
    N8nWorker -- Connects To --> PostgreSQL
    N8nWorker -- Connects To --> Redis
    
    BastionHost -- Admin Access --> PostgreSQL
    BastionHost -- Admin Access --> Redis
```

## Architecture Diagram

The diagram above illustrates the n8n infrastructure deployed on AWS using CDK. Here's a breakdown of the components:

### Network Layer
- **VPC** spanning 2 Availability Zones
- **Subnets** in each AZ:
  - Public subnets (for internet-facing resources)
  - Private subnets (for application components)
  - Isolated subnets (for database components)
- **Internet Gateway** for public internet access
- **NAT Gateway** for outbound internet access from private subnets

### Compute Layer
- **ECS Cluster** running Fargate tasks:
  - n8n Main Service (1 vCPU, 2GB RAM)
  - n8n Worker Service (1 vCPU, 2GB RAM)
  - PostgreSQL container (1 vCPU, 2GB RAM)
  - Redis container (0.5 vCPU, 1GB RAM)

### Storage Layer
- **EFS (Elastic File System)** with access points for:
  - n8n data persistence
  - PostgreSQL data persistence
  - Redis data persistence

### Access Layer
- **Application Load Balancer** for routing traffic to n8n services
- **Bastion Host** (t3.micro) for administrative access

### Supporting Services
- **AWS Cloud Map** for service discovery
- **Secrets Manager** for storing n8n encryption key
- **CloudWatch Logs** for centralized logging

### Data Flow
1. Users access the n8n UI through the internet-facing ALB
2. n8n services run in private subnets and communicate with PostgreSQL and Redis
3. All services mount EFS for persistent storage
4. Services discover each other using AWS Cloud Map
5. All components log to CloudWatch
6. Administrators can access the environment through the Bastion Host

This architecture provides a scalable, resilient, and secure environment for running n8n workflow automation platform on AWS.