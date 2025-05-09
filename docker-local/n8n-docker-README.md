# n8n Docker Setup

This repository contains Docker configuration for running n8n with persistent data storage.

## Requirements

- Docker
- Docker Compose

## Usage

1. Clone this repository
2. Run the following command to start n8n:

```bash
docker-compose up -d
```

3. Access n8n in your browser at: http://localhost:5678

## Data Persistence

All n8n data is stored in a Docker volume named `n8n-data` which persists between container restarts.

## Environment Variables

You can modify the environment variables in the `docker-compose.yml` file:

- `N8N_ENCRYPTION_KEY`: Change this to a secure random string
- `N8N_HOST`: The hostname where n8n will be accessible
- `N8N_PROTOCOL`: http or https

## Security

For production use, consider:

- Changing the default encryption key
- Setting up proper authentication
- Using HTTPS instead of HTTP

## Stopping n8n

To stop the containers:

```bash
docker-compose down
```

To stop and remove the volume (will delete all data):

```bash
docker-compose down -v
```
