const assert=require('node:assert/strict'),{audit}=require('../tools/audit-rl-artifacts.cjs');
const p={sizes:[1,1],weights:[0,0],gens:20,bestReturn:5},e={info:{outcome:'timeout'},traj:[]},csv='gen,meanReturn\n5,5\n20,1';
const r=audit(p,e,csv);assert.equal(r.storedGeneration,20);assert.equal(r.bestLoggedGeneration,5);
assert.throws(()=>audit({...p,weights:[0]},e,csv));assert.throws(()=>audit(p,e,'gen,meanReturn\n1,NaN'));
console.log('PASS artifact audit: saved vs best generation, dimensions, invalid log');
