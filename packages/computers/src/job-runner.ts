/**
 * A private, detached Node supervisor. Unlike a timer in the daemon, this deadline survives
 * the daemon exiting. Arguments, not interpolation, carry commands and paths. The supervised
 * command has its own process group; the supervisor stays outside it to enforce escalation.
 * This is used on POSIX; Windows keeps its existing console/launcher handling.
 */
export const JOB_RUNNER = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const [dir, stopped, file, args, deadlineText, capText] = process.argv.slice(1);
const startedAt = process.hrtime.bigint(), deadline = BigInt(deadlineText), cap = Number(capText);
const remaining = () => Number(deadline - process.hrtime.bigint()) / 1e6;
let child, done = false, ended, limit, measure, escalation;
const signal = (what) => {
  if (!child || child.pid === undefined) return;
  try { process.kill(-child.pid, what); } catch {}
};
const finish = (code) => {
  if (done) return;
  done = true;
  clearTimeout(limit); clearInterval(measure);
  const late = ended === "limit";
  try {
    const tmp = path.join(dir, "exit." + process.pid + ".tmp");
    fs.writeFileSync(tmp, (late ? 124 : code) + " " + (late ? 1 : 0) + " " + Math.floor(Number(process.hrtime.bigint() - startedAt) / 1e6) + "\n");
    fs.renameSync(tmp, path.join(dir, "exit"));
  } catch {}
  // The leader exiting does not prove its background children left the group.
  signal("SIGTERM");
  let remains = false;
  if (child && child.pid !== undefined) { try { process.kill(-child.pid, 0); remains = true; } catch {} }
  if (remains && !escalation) escalation = setTimeout(() => signal("SIGKILL"), 4000);
  if (!remains) { clearTimeout(escalation); escalation = undefined; }
  process.exitCode = late ? 124 : code;
};
const stop = (why) => {
  if (ended || done) return;
  ended = why;
  signal("SIGTERM");
  escalation = setTimeout(() => { signal("SIGKILL"); }, 4000);
};
process.on("SIGTERM", () => stop(remaining() <= 0 ? "limit" : "stop"));
process.on("SIGINT", () => stop("stop"));
try {
  fs.writeFileSync(path.join(dir, "pid"), String(process.pid));
  if (fs.existsSync(stopped)) { ended = "stop"; finish(143); }
  else if (remaining() <= 0) { ended = "limit"; finish(124); }
  else {
    const env = process.env._DC_JOB_ENV ? JSON.parse(process.env._DC_JOB_ENV) : { ...process.env };
    delete env._DC_JOB_ENV;
    child = spawn(file, JSON.parse(args), { detached: true, stdio: ["ignore", 1, 2], env });
    child.on("error", (error) => { console.error("Could not start the command: " + error.message); finish(127); });
    child.on("exit", (code, sig) => finish(code ?? (sig === "SIGKILL" ? 137 : 143)));
    limit = setTimeout(() => stop("limit"), Math.max(0, remaining()));
    measure = setInterval(() => {
      try {
        if (fs.existsSync(stopped)) stop("stop");
        else if (fs.statSync(path.join(dir, "output.log")).size > cap) stop("output");
      } catch {}
    }, 100);
    if (child.pid !== undefined) fs.writeFileSync(path.join(dir, "child.pid"), String(child.pid));
  }
} catch (error) { console.error("Could not supervise the command: " + error.message); stop("supervision"); finish(127); }
`
