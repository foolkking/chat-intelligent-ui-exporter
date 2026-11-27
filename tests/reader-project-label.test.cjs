const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,"../reader/routes.js"),"utf8"),ctx);
test("project display names reject identifier fallbacks but retain genuine labels",()=>{
  const name=ctx.ReaderRoutes.projectName,p="g-p-"+"ab".repeat(16);
  for(const value of [undefined,null,0," ",p,p+"-a-name","project:"+p,"/g/"+p+"/project","ab".repeat(16),"00000000-0000-4000-8000-000000000001"])
    assert.equal(name(value,p),"");
  assert.equal(name("internal-key","internal-key"),"");
  assert.equal(name("project:internal-key","internal-key"),"");
  for(const value of ["潮汐研究","My project","Project: review"])
    assert.equal(name(" "+value+" ",p),value);
});
