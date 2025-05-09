#!/bin/bash

#set -xeu
# psql -h postgres.n8n.internal -p 5432 -U postgres -d postgres


export AWS_PROFILE=aws-profile
export INSTANCE_ID=<aws-bastion-instance-id>
export ENV=stg
export NAMESPACE=n8n-${ENV}.internal


aws ssm start-session  \
 --region us-east-1 \
 --profile $AWS_PROFILE\
 --target $INSTANCE_ID \
 --document-name AWS-StartPortForwardingSessionToRemoteHost \
 --parameters "host=postgres.$NAMESPACE,portNumber=5432,localPortNumber=5432"

