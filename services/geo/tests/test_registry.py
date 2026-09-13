from copy import deepcopy
import pytest
from geo.registry import check_registry, query_registry
from geo.validation import InputError

FRAME={'id':'LOCAL-TEST','horizontalUnit':'m','verticalUnit':'m','benchmark':'BM-SYNTHETIC'}
def rect(x0,y0,x1,y1):return [[x0,y0],[x1,y0],[x1,y1],[x0,y1]]
def record(name,footprint,lower,upper):
    unit={'id':name,'alias':name,'name':name,'kind':'unit','revision':1,'levelLabel':'Test',
          'footprint':footprint,'lower':lower,'upper':upper,'lowerVerified':False,'upperVerified':False,'bindings':{}}
    return {'id':name,'identifier':name,'kind':'space','footprint':footprint,'geometry':unit,'links':[]}
def test_independent_excavation_volumes():
    records=[record('BASE',rect(2,2,22,12),-3,0),record('UTIL',rect(0,13,24,15),-5,-4)]
    result=query_registry({'frame':FRAME,'queryFrame':FRAME,'records':records,'mode':'volume','footprint':rect(10,11,14,14),'lower':-5,'upper':0})
    assert {r['record']['id']:r['volume'] for r in result['results']}=={'BASE':12,'UTIL':4}
def test_vertical_order_and_boundary():
    records=[record('upper',rect(2,2,6,12),3,6),record('base',rect(2,2,22,12),-3,0),record('ground',rect(2,2,6,12),0,3)]
    result=query_registry({'frame':FRAME,'queryFrame':FRAME,'records':records,'mode':'point','point':[4,6]})
    assert [r['record']['id'] for r in result['results']]==['base','ground','upper']
    assert not any(r['contact'] for r in result['results'])
    result=query_registry({'frame':FRAME,'queryFrame':FRAME,'records':records,'mode':'point','point':[2,6]})
    assert all(r['contact'] for r in result['results'])
def test_adjoining_units_and_context():
    records=[record('a',rect(2,2,12,12),0,3),record('b',rect(12,2,22,12),0,3),{'id':'building','kind':'building','footprint':rect(2,2,22,12),'links':[]}]
    result=check_registry({'frame':FRAME,'records':records,'inputFingerprint':'test'})
    assert not any(f['code']=='OVERLAP' for f in result['findings'])
    assert any(f['code']=='BOUNDARY_CONTACT' for f in result['findings'])
def test_apartment_correction_eight_cubic_metres():
    records=[record('ground',rect(2,2,6,12),0,3),record('upper',rect(2,2,6,12),2.8,6)]
    result=check_registry({'frame':FRAME,'records':records,'inputFingerprint':'test'})
    assert sum(f['overlap']['volume'] for f in result['findings'] if f['code']=='OVERLAP')==pytest.approx(8)
    records[1]['geometry']['lower']=3
    assert not any(f['code']=='OVERLAP' for f in check_registry({'frame':FRAME,'records':records,'inputFingerprint':'corrected'})['findings'])
def test_frame_and_invalid_polygon_rejected():
    with pytest.raises(InputError):query_registry({'frame':FRAME,'queryFrame':{**FRAME,'benchmark':'other'},'mode':'point','point':[0,0],'records':[]})
    with pytest.raises(InputError):query_registry({'frame':FRAME,'queryFrame':FRAME,'mode':'volume','footprint':[[0,0],[2,2],[0,2],[2,0]],'lower':-2,'upper':0,'records':[]})
def test_missing_relationship_rejected():
    r=record('a',rect(0,0,2,2),0,3);r['links']=[{'type':'within','targetId':'missing'}]
    with pytest.raises(InputError):check_registry({'frame':FRAME,'records':[r],'inputFingerprint':'test'})

def test_context_only_site_can_be_reviewed():
    result=check_registry({'frame':FRAME,'records':[{'id':'parcel','kind':'parcel','footprint':rect(0,0,12,16),'links':[]}],'inputFingerprint':'context'})
    assert result['units']==[] and result['findings']==[]
    assert result['inputFingerprint']=='context'
