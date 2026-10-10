import { defineApp } from "convex/server";
import spectrum from "@spectrum-ts/convex/convex.config";

// Registered against the inspected @spectrum-ts/convex 0.1.1 component API.
const app = defineApp();
app.use(spectrum);
export default app;
