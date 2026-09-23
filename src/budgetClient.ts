export async function getBudgetStatus(){const r=await fetch('/api/status');return r.json();}
export async function updateMonthlyBudget(budgetUsd:number){const r=await fetch('/api/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({budgetUsd})});return r.json();}
