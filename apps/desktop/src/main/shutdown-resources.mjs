// Every resource gets a shutdown attempt even when another resource fails.
export async function shutdownResources(steps){
 const failed=[];
 for(let index=0;index<steps.length;index++){
  try{await steps[index]()}catch{failed.push(index)}
 }
 return {failed};
}
