#!/bin/bash

# Exit on error
set -e

export AWS_REGION=us-east-1
export AWS_PROFILE=aws-profile
export INSTANCE_ID=instance-id

# Debug AWS CLI version and configuration
echo "AWS CLI Version:"
aws --version
echo "Current AWS Profile:"
aws configure list --profile $AWS_PROFILE



# Execute command
aws ssm start-session \
    --profile $AWS_PROFILE \
    --region $AWS_REGION \
    --target $INSTANCE_ID

