'use client';
import {useOfficerStore} from '../shared/store';
import PropertySearch from '../shared/PropertySearch';
import type {PropertyChoice} from '../shared/PropertySearch';
export type {PropertyChoice};
export default function PropertyChooser({onChoose}:{onChoose:(property:PropertyChoice)=>void}){
 const recent=useOfficerStore(s=>s.recentProperties);return <PropertySearch onChoose={onChoose} recent={recent}/>;
}
