const { execFile, spawn } = require("child_process");
function execFileAsync(file, args, { timeoutMs = 30000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, maxBuffer: 128 * 1024 * 1024, cwd, timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
          return;
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
      }
    );
  });
}

module.exports = { execFile, spawn, execFileAsync };
