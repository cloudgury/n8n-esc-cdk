#!/bin/bash

# Set variables
SCRIPT_FOLDER="/opt/scripts"
BASE="/opt/scripts"
LOG_FILE="${BASE}/init.log"

# Create necessary directories
mkdir -p $SCRIPT_FOLDER

# Log configuration details
{
  echo "SCRIPT_FOLDER: $SCRIPT_FOLDER"
  echo "BASE: $BASE"
  echo "LOG_FILE: $LOG_FILE"
} > $LOG_FILE

# Installation and configuration steps
echo "Start time: $(date)" >> $LOG_FILE

echo "Starting installation of PostgreSQL: $(date)" >> $LOG_FILE
sudo dnf install -y postgresql15 >> $LOG_FILE 2>&1
echo "Finished installation of PostgreSQL: $(date)" >> $LOG_FILE


echo "Starting download and installation telnet: $(date)" >> $LOG_FILE
sudo yum install -y telnet  >> $LOG_FILE 2>&1
echo "Finished installation of telenet: $(date)" >> $LOG_FILE

# Create a file system and attach the drive.
echo "Starting to create a file system and attach the drive: $(date)" >> $LOG_FILE
sudo file -s /dev/xvdb >> $LOG_FILE 2>&1
sudo mkfs -t xfs /dev/xvdb >> $LOG_FILE 2>&1
sudo mkdir -p /data
# sudo mount /dev/xvdb /data

# Find the UUID of /dev/xvdf
UUID=$(sudo blkid -o value -s UUID /dev/xvdb)

# Check if UUID was found
if [ -z "$UUID" ]; then
    echo "UUID for /dev/xvdb not found." >> $LOG_FILE
    exit 1
fi

# Since /data is already used, ensure the script's intention matches the drive operations
MOUNT_POINT="/data"

# No need to check or create $MOUNT_POINT as it's done above

# Prepare the fstab entry
FSTAB_ENTRY="UUID=$UUID $MOUNT_POINT xfs defaults 0 2"

# Check if the entry already exists in /etc/fstab
if grep -qs "$FSTAB_ENTRY" /etc/fstab; then
    echo "Entry for /dev/xvdb already exists in /etc/fstab." >> $LOG_FILE
else
    # Append the entry to /etc/fstab
    echo "$FSTAB_ENTRY" | sudo tee -a /etc/fstab > /dev/null
    echo "Added /dev/xvdb to /etc/fstab." >> $LOG_FILE
fi

sudo mount /dev/xvdb /data
echo "ls -la /data  $(date)" >> $LOG_FILE
sudo mkdir /data/db-backups
echo "Finished create file system and attached the drive: $(date)" >> $LOG_FILE


echo "Finish time: $(date)" >> $LOG_FILE
