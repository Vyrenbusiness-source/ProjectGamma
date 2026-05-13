const fs = require("fs");
const s = JSON.parse(fs.readFileSync("./store.json", "utf8"));
const p = s.projects.find(x => x.id === "projectgamma");
console.log("ACTIVITY (top 12 full):");
p.activity.slice(0, 12).forEach((e, i) => {
  console.log("\n--- #" + i + " [" + e.type + "] ---");
  console.log(e.text);
});
console.log("\n\n=== ALL RULES (suggestedBy='cloud-code'): ===");
p.rules.filter(r => r.suggestedBy === "cloud-code").forEach(r => {
  console.log("[" + r.category + "] " + r.text + "  active=" + r.active);
});
