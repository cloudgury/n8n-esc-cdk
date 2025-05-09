#!/bin/bash

# Exit on error
set -e

export AWS_REGION=us-east-1
export AWS_PROFILE="aws-profile"
export SERVICE_NAME=postgres-service
export PREFIX=stg
export CLUSTER_NAME=n8n-${PREFIX}-workflow-cluster

# Debug AWS CLI version and configuration
echo "AWS CLI Version:"
aws --version
echo "Current AWS Profile:"
aws configure list --profile $AWS_PROFILE

# Get the task ARN
echo "Listing tasks..."
TASK_ARN=$(aws ecs list-tasks \
    --profile $AWS_PROFILE\
    --region us-east-1 \
    --cluster ${CLUSTER_NAME} \
    --output json | jq --raw-output '.taskArns[2]')

# # Check if task ARN is empty
if [ -z "$TASK_ARN" ]; then
    echo "Error: No running tasks found for service ${SERVICE_NAME}"
    exit 1
fi

echo "Connecting to task: ${TASK_ARN}"

# # Execute command
aws ecs execute-command \
    --profile  $AWS_PROFILE \
    --region us-east-1 \
    --cluster ${CLUSTER_NAME} \
    --task ${TASK_ARN} \
    --container "postgres" \
    --interactive \
    --command "/bin/bash"