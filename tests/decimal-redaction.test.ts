/** Lexical privacy controls only; these numbers/labels are not operational records. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {redactPrivateText,redactDerivative,redactDocumentViews} from '../packages/server/src/modules/usp/ingest/redact';

test('numeric masking avoids joining two complete adjacent decimal tokens',()=>{
  for(const value of ['503428.861 4312740.801','-503428.861\t-4312740.801',
    '1.678 1234567.0','1.6789 12345678.0','1.67891234 12345678.0']){
    assert.equal(redactPrivateText(value),value);
    assert.equal(redactDerivative(value),value);
  }
});

test('complete phones and identifiers retain masking with punctuation, formatting and ambiguous decimal suffixes',()=>{
  for(const value of ['Call.9876543210.','(9876543210)','+91 98765-43210','(+91) 98765 43210',
    '09876543210','9876543210.000','.9876543210','1.9876543210','1.98765 43210',
    'v1.987 6543210.0','--1.987 6543210.0'])assert.match(redactPrivateText(value),/\[redacted phone\]/);
  for(const value of ['1234 5678 9012','1234-5678-9012','ID.123456789012.0','1.123456789012'])
    assert.match(redactPrivateText(value),/\[redacted (?:identifier|Aadhaar)\]/);
  assert.match(redactPrivateText('1234 5678 9012 3456'),/\[redacted VID\]/);
  assert.match(redactPrivateText('ABCDE1234Z'),/\[redacted PAN\]/);
  assert.match(redactPrivateText('contact@test.invalid'),/\[redacted email\]/);
  assert.match(redactPrivateText('contact [at] test [dot] invalid'),/\[redacted email\]/);
});

test('personal labels override decimal context and JSON/historical previews preserve existing identifier protection',()=>{
  for(const text of ['Phone: 6.9876543210','Mobile: 503428.861 4312740.801','Owner Name: Control Person',
    'Email: contact@test.invalid'])assert.match(redactPrivateText(text),/\[redacted personal field\]/);
  assert.equal(redactDerivative({phone:'6.9876543210'}).phone,'[redacted personal field]');
  const state={ownerName:null,email:'withheld',phone:'unknown',pan:'conflicting'};
  assert.deepEqual(redactDerivative(state),state);
  const exponential=Number('9876543210').toExponential();
  assert.notEqual(JSON.parse(redactDerivative(exponential)),9876543210);
  assert.notEqual(JSON.parse(redactDocumentViews({parts:[{text:exponential,locator:{line:1}}]}).parts[0].text),9876543210);
  assert(!redactDerivative('[9876543210,12]').includes('9876543210'));
});
