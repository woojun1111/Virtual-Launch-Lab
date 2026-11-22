const {readdirSync}=require('node:fs');
const {join}=require('node:path');
const {spawnSync}=require('node:child_process');
const root=join(__dirname,'..');
for(const file of readdirSync(join(root,'tests')).filter(f=>f.endsWith('.cjs')).sort()) {
  console.log(`\nLegacy: ${file}`);
  const result=spawnSync(process.execPath,[join(root,'tests',file)],{cwd:root,stdio:'inherit'});
  if(result.status!==0) process.exit(result.status || 1);
}
