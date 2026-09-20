"use client";
import AreaLayer, { type AreaViewerProps } from "./layers/AreaLayer";
import LocalModelLayer, { type LocalModelProps } from "./layers/LocalModelLayer";
import TileLayer, { type TileLayerProps } from "./layers/TileLayer";
import dynamic from 'next/dynamic';
import type {ReferenceLayerProps} from './layers/ReferenceLayer';
const ReferenceLayer=dynamic(()=>import('./layers/ReferenceLayer'),{ssr:false});
export type MapViewportSource = {
    kind:'canonical-scene';
    props:ReferenceLayerProps;
} | {
    kind: "area";
    props: AreaViewerProps;
} | {
    kind: "local-model";
    props: LocalModelProps;
} | {
    kind: "tiles";
    props: TileLayerProps;
};
/** Single viewport boundary; source-specific geometry adapters share one engine factory. */
export function MapViewport({ source }: {
    source: MapViewportSource;
}) {
    return source.kind === 'canonical-scene'?<ReferenceLayer {...source.props}/>:source.kind === "tiles" ? <TileLayer {...source.props}/> : source.kind === "area" ? <AreaLayer {...source.props}/> : <LocalModelLayer {...source.props}/>;
}
