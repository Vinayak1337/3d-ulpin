import type {ReactNode} from 'react';
import {SpatialDataProvider} from '@/features/spatial/data/Provider';

export default function StudioLayout({children}:{children:ReactNode}){
 return <SpatialDataProvider>{children}</SpatialDataProvider>;
}
