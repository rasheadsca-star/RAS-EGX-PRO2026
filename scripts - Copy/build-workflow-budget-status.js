/*
EGX Pro Hub V8.4 — Workflow Budget Status
Creates a small transparent status file describing the current workflow budget strategy.
*/
const fs=require("fs");
const path=require("path");
function write(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj,null,2),"utf8")}
function main(){
  const event=process.env.GITHUB_EVENT_NAME||"local";
  const historyMaintenance=process.env.HISTORY_MAINTENANCE||"false";
  write("data/workflow-budget-status.json",{
    ok:true,
    engine:"v8_4_workflow_budget_status",
    generatedAt:new Date().toISOString(),
    event,
    schedule:"once_daily_after_session",
    heavyHistoryMaintenance:event==="workflow_dispatch" && historyMaintenance==="true" ? "enabled_for_this_manual_run" : "manual_only_skipped",
    commitPolicy:"single_final_commit_after_all_generated_reports",
    protectedFiles:[
      "data/full-market-cache.json",
      "data/scan-state.json",
      "data/history.json"
    ],
    note:"V8.4 moves all generated reports before the final commit and reduces scheduled runs to once daily."
  });
  console.log("Workflow budget status generated");
}
main();
