export const capitalize = (str: string) =>
  str.charAt(0).toUpperCase() + str.slice(1);

export const logMessage = (
  type: string,
  filename: string,
  value: string,
  enableDebugLogs: boolean
) => {
  if (enableDebugLogs) {
    console.info(
      `-------GETTING INFO FOR ${type} [${require("path").relative(
        process.cwd(),
        filename
      )}]------: ${value}`
    );
  }
};

export const logConfig = (
  filename: string,
  config: Record<string, any>,
  enableDebugLogs: boolean
) => {
  if (enableDebugLogs) {
    console.info(
      `-------CONFIGURATION DETAILS [${require("path").relative(
        process.cwd(),
        filename
      )}]-------`
    );
    console.log(config);
  }
};
