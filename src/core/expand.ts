﻿namespace MakerJs.path {

    /**
     * @private
     */
    var map: { [type: string]: (pathValue: IPath, expansion: number, isolateCaps: boolean) => IModel } = {};

    map[pathType.Arc] = function (arc: IPathArc, expansion: number, isolateCaps: boolean) {
        return new models.OvalArc(arc.startAngle, arc.endAngle, arc.radius, expansion, false, isolateCaps);
    };

    map[pathType.Circle] = function (circle: IPathCircle, expansion: number, isolateCaps: boolean) {
        return new models.Ring(circle.radius + expansion, circle.radius - expansion);
    }

    map[pathType.Line] = function (line: IPathLine, expansion: number, isolateCaps: boolean) {
        return new models.Slot(line.origin, line.end, expansion, isolateCaps);
    }

    /**
     * Expand path by creating a model which surrounds it.
     *
     * @param pathToExpand Path to expand.
     * @param expansion Distance to expand.
     * @param isolateCaps Optional flag to put the end caps into a separate model named "caps".
     * @returns Model which surrounds the path.
     */
    export function expand(pathToExpand: IPath, expansion: number, isolateCaps?: boolean): IModel {

        if (!pathToExpand) return null;

        var result: IModel = null;

        var fn = map[pathToExpand.type];
        if (fn) {
            result = fn(pathToExpand, expansion, isolateCaps);
            result.origin = pathToExpand.origin;
        }

        return result;
    }

    /**
     * Represent an arc using straight lines.
     *
     * @param arc Arc to straighten.
     * @param bevel Optional flag to bevel the angle to prevent it from being too sharp.
     * @param prefix Optional prefix to apply to path ids.
     * @returns Model of straight lines with same endpoints as the arc.
     */
    export function straighten(arc: IPathArc, bevel?: boolean, prefix?: string): IModel {

        var arcSpan = angle.ofArcSpan(arc);
        var joints = 1;

        if (arcSpan >= 270) {
            joints = 4;
        } else if (arcSpan > 180) {
            joints = 3;
        } else if (arcSpan > 150 || bevel) {   //30 degrees is the sharpest
            joints = 2;
        }

        var jointAngleInRadians = angle.toRadians(arcSpan / joints);
        var circumscribedRadius = models.Polygon.circumscribedRadius(arc.radius, jointAngleInRadians);
        var ends = point.fromArc(arc);
        var points: IPoint[] = [point.subtract(ends[0], arc.origin)];
        var a = angle.toRadians(arc.startAngle) + jointAngleInRadians / 2;

        for (var i = 0; i < joints; i++) {
            points.push(point.fromPolar(a, circumscribedRadius));
            a += jointAngleInRadians;
        }

        points.push(point.subtract(ends[1], arc.origin));

        var result = new models.ConnectTheDots(false, points);
        (<IModel>result).origin = arc.origin;

        if (typeof prefix === 'string' && prefix.length) {
            model.prefixPathIds(result, prefix);
        }

        return result;
    }

}

namespace MakerJs.model {

    /**
     * Expand all paths in a model, then combine the resulting expansions.
     *
     * @param modelToExpand Model to expand.
     * @param distance Distance to expand.
     * @param joints Number of points at a joint between paths. Use 0 for round joints, 1 for pointed joints, 2 for beveled joints.
     * @returns Model which surrounds the paths of the original model.
     */
    export function expandPaths(modelToExpand: IModel, distance: number, joints = 0, combineOptions: ICombineOptions = {}): IModel {

        if (distance <= 0) return null;

        var result: IModel = {
            models: {
                expansions: { models: {} },
                caps: { models: {} }
            }
        };

        var first = true;

        //TODO: work without origination
        var originated = originate(modelToExpand);

        var walkOptions: IWalkOptions = {
            onPath: function (walkedPath: IWalkPath) {
                var expandedPathModel = path.expand(walkedPath.pathContext, distance, true);

                if (expandedPathModel) {
                    var newId = getSimilarModelId(result.models['expansions'], walkedPath.pathId);

                    prefixPathIds(expandedPathModel, walkedPath.pathId + '_');
                    originate(expandedPathModel);

                    if (!first) {
                        combine(result, expandedPathModel, false, true, false, true, combineOptions);
                        combineOptions.measureA.modelsMeasured = false;
                        delete combineOptions.measureB;
                    }

                    result.models['expansions'].models[newId] = expandedPathModel;

                    if (expandedPathModel.models) {
                        var caps = expandedPathModel.models['Caps'];

                        if (caps) {
                            delete expandedPathModel.models['Caps'];

                            result.models['caps'].models[newId] = caps;
                        }
                    }

                    first = false;
                }
            }
        };

        walk(originated, walkOptions);

        if (joints) {

            var roundCaps = result.models['caps'];

            simplify(roundCaps);

            var straightCaps: IModel = { models: {} };

            //straighten each cap, optionally beveling
            for (var id in roundCaps.models) {

                var straightened: IModel = { models: {} };

                walkPaths(roundCaps.models[id], function (modelContext: IModel, pathId: string, pathContext: IPath) {
                    straightened.models[pathId] = path.straighten(<IPathArc>pathContext, joints == 2, pathId + '_');
                });

                straightCaps.models[id] = straightened;
            }

            //replace the rounded with the straightened
            result.models['caps'] = straightCaps;
        }

        return result;
    }

    /**
     * Outline a model by a specified distance. Useful for accommodating for kerf.
     *
     * @param modelToOutline Model to outline.
     * @param distance Distance to outline.
     * @param joints Number of points at a joint between paths. Use 0 for round joints, 1 for pointed joints, 2 for beveled joints.
     * @param inside Optional boolean to draw lines inside the model instead of outside.
     * @returns Model which surrounds the paths outside of the original model.
     */
    export function outline(modelToOutline: IModel, distance: number, joints = 0, inside = false): IModel {
        var expanded = expandPaths(modelToOutline, distance, joints);

        if (!expanded) return null;

        var loops = findLoops(expanded);
        if (loops && loops.models) {

            var i = 0;

            while (loops.models[i]) {

                if (inside) {
                    delete loops.models[i];
                    delete loops.models[i + 3];
                } else {
                    delete loops.models[i + 1];
                    delete loops.models[i + 2];
                }

                i += 4;
            }

            return loops;
        }

        return null;
    }

}