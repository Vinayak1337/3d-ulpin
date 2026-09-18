"use client";
import AreaLayer, { type AreaViewerProps } from "./layers/AreaLayer";
import LocalModelLayer, { type LocalModelProps } from "./layers/LocalModelLayer";
import TileLayer, { type TileLayerProps } from "./layers/TileLayer";
export type MapViewportSource = {
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
    return source.kind === "tiles" ? <TileLayer {...source.props}/> : source.kind === "area" ? <AreaLayer {...source.props}/> : <LocalModelLayer {...source.props}/>;
}
