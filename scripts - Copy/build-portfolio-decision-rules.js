/*
EGX Pro Hub V9.6 — Portfolio Decision Rules
Builds market-side decision rules from final ranking. Actual portfolio decisions are computed locally in the browser from the user's portfolio.
*/
const fs=require("fs"), path=require("path");
function read(f,d){try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2),"utf8")}
function main(){
  const ranking=read("data/final-opportunity-ranking.json",{rows:[]});
  const rules=(ranking.rows||[]).map(r=>{
    let action="watch";
    if(r.grade==="P1")action="increase_conditionally";
    else if(r.grade==="P2")action="hold_or_add_on_confirmation";
    else if(r.grade==="Blocked")action="do_not_add_review";
    else if(r.grade==="P3")action="watch_only";
    return {symbol:r.symbol,grade:r.grade,action,targetProbability:r.targetProbability,expectedReturnPct:r.expectedReturnPct,rr:r.rr,priceState:r.priceState,why:r.why};
  });
  write("data/portfolio-decision-rules.json",{ok:true,engine:"v9_6_portfolio_decision_rules",generatedAt:new Date().toISOString(),total:rules.length,rules,note:"Rules are market-side. Browser combines them with local portfolio weights/PnL to produce final portfolio decisions."});
  console.log("Portfolio decision rules", rules.length);
}
main();
