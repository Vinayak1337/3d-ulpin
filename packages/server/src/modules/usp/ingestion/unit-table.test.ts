import test from 'node:test';
import assert from 'node:assert/strict';
import {UNIT_TABLE} from './unit-table';

test('only code-owned factors with cited definitions are executable; unresolved regional units abstain',()=>{
  assert.equal(UNIT_TABLE.ft2.factor,0.09290304);assert.equal(UNIT_TABLE.sq_yd.factor,0.83612736);
  for(const definition of Object.values(UNIT_TABLE)){
    if(definition.state==='supported')assert(definition.source?.startsWith('https://'));
    else {assert.equal(definition.factor,null);assert.equal(definition.source,null);}
  }
  for(const unit of ['gaj','marla','bigha','kanal','cent','guntha'] as const)assert.equal(UNIT_TABLE[unit].state,'needs_input');
});
