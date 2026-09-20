'use client';
import App from './App';
import {StudioViewportProvider} from './scene/SharedViewport';
import {SpatialDataProvider} from '../spatial/data/Provider';
export default function StudioApp(){return <SpatialDataProvider><StudioViewportProvider><App/></StudioViewportProvider></SpatialDataProvider>;}
