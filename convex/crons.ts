import { cronJobs } from "convex/server";

// No unimplemented jobs are scheduled. Lane C owns the P1 weather registration.
const crons = cronJobs();
export default crons;
