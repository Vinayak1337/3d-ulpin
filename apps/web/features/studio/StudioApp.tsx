'use client';
import App from './App';
import {StudioViewportProvider} from './scene/SharedViewport';
export default function StudioApp(){return <StudioViewportProvider><App/></StudioViewportProvider>;}
