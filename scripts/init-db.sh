#!/bin/bash
set -e


TARGET_DB_NAME=n8n
DROP_DB=true

# Process command line arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        -d|--drop) DROP_DB=true ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done


# If SECRET_NAME is provided, fetch credentials from AWS Secrets Manager
if [ -n "$ADMIN_SECRET_NAME" ]; then
    if ! command -v aws >/dev/null 2>&1; then
        echo "AWS CLI is required but not installed. Exiting." >&2
        exit 1
    fi
    if ! command -v jq >/dev/null 2>&1; then
        echo "jq is required but not installed. Exiting." >&2
        exit 1
    fi
    echo "Fetching PostgreSQL credentials from AWS Secrets Manager: $ADMIN_SECRET_NAME"
    SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id "$ADMIN_SECRET_NAME" --query SecretString --output text)
    POSTGRES_USER=$(echo "$SECRET_JSON" | jq -r '.username // .user // .POSTGRES_USER // .POSTGRESUsername // empty')
    POSTGRES_PASSWORD=$(echo "$SECRET_JSON" | jq -r '.password // .POSTGRES_PASSWORD // .POSTGRESPassword // empty')
    if [ -z "$POSTGRES_USER" ] || [ -z "$POSTGRES_PASSWORD" ]; then
        echo "Failed to extract username or password from secret. Exiting." >&2
        exit 1
    fi
else
    POSTGRES_USER=postgres
    POSTGRES_PASSWORD=""
fi

# If SECRET_NAME2 is provided, fetch non-root credentials from AWS Secrets Manager
if [ -n "$APP_SECRET_NAME" ]; then
    if ! command -v aws >/dev/null 2>&1; then
        echo "AWS CLI is required but not installed. Exiting." >&2
        exit 1
    fi
    if ! command -v jq >/dev/null 2>&1; then
        echo "jq is required but not installed. Exiting." >&2
        exit 1
    fi
    echo "Fetching non-root PostgreSQL credentials from AWS Secrets Manager: $APP_SECRET_NAME"
    SECRET2_JSON=$(aws secretsmanager get-secret-value --secret-id "$APP_SECRET_NAME" --query SecretString --output text)
    POSTGRES_NON_ROOT_USER=$(echo "$SECRET2_JSON" | jq -r '.username // .user // .POSTGRES_USER // .POSTGRESUsername // empty')
    POSTGRES_NON_ROOT_PASSWORD=$(echo "$SECRET2_JSON" | jq -r '.password // .POSTGRES_PASSWORD // .POSTGRESPassword // empty')
    if [ -z "$POSTGRES_NON_ROOT_USER" ] || [ -z "$POSTGRES_NON_ROOT_PASSWORD" ]; then
        echo "Failed to extract non-root username or password from secret. Exiting." >&2
        exit 1
    fi
fi


echo "===== Starting PostgreSQL initialization ====="
echo "APP_SECRET_NAME: $APP_SECRET_NAME"
echo "ADMIN_SECRET_NAME: $ADMIN_SECRET_NAME"
echo "Database user: $POSTGRES_USER"
echo "Database password: $POSTGRES_PASSWORD"
echo "Target database: $TARGET_DB_NAME"
echo "Non-root user: $POSTGRES_NON_ROOT_USER"
echo "Non-root user password: $POSTGRES_NON_ROOT_PASSWORD"
echo "Drop database if exists: $DROP_DB"


echo "Checking if database exists..."
# Check if the database exists
DB_EXISTS=$(psql -v ON_ERROR_STOP=0 --username "$POSTGRES_USER" --dbname postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$TARGET_DB_NAME'")

# Drop database if it exists and DROP_DB flag is true
if [ "$DB_EXISTS" = "1" ] && [ "$DROP_DB" = "true" ]; then
    echo "Database '$TARGET_DB_NAME' exists and drop flag is set. Dropping database..."
    psql -v ON_ERROR_STOP=0 --username "$POSTGRES_USER" --dbname postgres -c "DROP DATABASE $TARGET_DB_NAME;"
    echo "Database '$TARGET_DB_NAME' dropped successfully"
    DB_EXISTS=""
fi

# Create the database if it doesn't exist
if [ "$DB_EXISTS" != "1" ]; then
    rm -f /tmp/create_db.sql
    cat <<ENDSQL > /tmp/create_db.sql
CREATE DATABASE $TARGET_DB_NAME;
ENDSQL
    psql -v ON_ERROR_STOP=0 --username "$POSTGRES_USER" --dbname postgres -f /tmp/create_db.sql
    echo "Database '$TARGET_DB_NAME' created successfully"
else
    echo "Database '$TARGET_DB_NAME' already exists, continuing..."
fi

# Create the non-root user if it doesn't exist
echo "Checking if user '$POSTGRES_NON_ROOT_USER' exists..."
if psql -v ON_ERROR_STOP=0 --username "$POSTGRES_USER" --dbname postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$POSTGRES_NON_ROOT_USER'" | grep -q 1; then
    echo "User '$POSTGRES_NON_ROOT_USER' already exists"
else
    echo "Creating user '$POSTGRES_NON_ROOT_USER'..."
    rm -f /tmp/create_user.sql
    cat <<ENDSQL > /tmp/create_user.sql
CREATE USER $POSTGRES_NON_ROOT_USER WITH PASSWORD '$POSTGRES_NON_ROOT_PASSWORD';
ALTER USER $POSTGRES_NON_ROOT_USER CREATEDB;
ENDSQL
    psql -v ON_ERROR_STOP=0 --username "$POSTGRES_USER" --dbname postgres -f /tmp/create_user.sql
    echo "User '$POSTGRES_NON_ROOT_USER' created successfully"
fi

# Grant privileges to the non-root user on the database
echo "Granting privileges to '$POSTGRES_NON_ROOT_USER' on database '$TARGET_DB_NAME'..."
rm -f /tmp/grant_db.sql
cat <<ENDSQL > /tmp/grant_db.sql
GRANT ALL PRIVILEGES ON DATABASE $TARGET_DB_NAME TO $POSTGRES_NON_ROOT_USER;
ENDSQL
psql -v ON_ERROR_STOP=0 --username "$POSTGRES_USER" --dbname postgres -f /tmp/grant_db.sql

# Now connect to the n8n database to grant schema privileges
echo "Connecting to $TARGET_DB_NAME database to grant schema privileges..."
rm -f /tmp/grant_schema.sql
cat <<ENDSQL > /tmp/grant_schema.sql
GRANT ALL PRIVILEGES ON SCHEMA public TO $POSTGRES_NON_ROOT_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $POSTGRES_NON_ROOT_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $POSTGRES_NON_ROOT_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO $POSTGRES_NON_ROOT_USER;
ENDSQL
psql -v ON_ERROR_STOP=0 --username "$POSTGRES_USER" --dbname "$TARGET_DB_NAME" -f /tmp/grant_schema.sql
echo "Privileges granted successfully"

# Clean up temporary files
rm -f /tmp/create_db.sql /tmp/create_user.sql /tmp/grant_db.sql /tmp/grant_schema.sql

echo "===== Testing connection with new credentials ====="
echo "Attempting to connect to $TARGET_DB_NAME database as $POSTGRES_NON_ROOT_USER..."

# Create a temporary test query file
cat <<ENDSQL > /tmp/test_connection.sql
\conninfo
SELECT current_database() as database, version() as version;
ENDSQL

# Test the connection using the non-root user
# Export password to environment to avoid command line password exposure
export PGPASSWORD="$POSTGRES_NON_ROOT_PASSWORD"
if psql -v ON_ERROR_STOP=1 -X --username "$POSTGRES_NON_ROOT_USER" --host="${POSTGRES_HOST:-localhost}" --port="${POSTGRES_PORT:-5432}" --dbname "$TARGET_DB_NAME" -f /tmp/test_connection.sql; then
    echo "✅ Connection test successful! The new user can connect to the database."
else
    echo "❌ Connection test failed! Please check the credentials and permissions."
    exit 1
fi

# Clean up
unset PGPASSWORD
rm -f /tmp/test_connection.sql

echo "===== Database initialization and testing completed =====" 