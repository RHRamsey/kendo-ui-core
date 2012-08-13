(function ($, undefined) {
    var kendo = window.kendo,
        support = kendo.support,
        pointers = support.pointers,
        document = window.document,
        SURFACE = $(document.documentElement),
        Class = kendo.Class,
        Widget = kendo.ui.Widget,
        Observable = kendo.Observable,
        proxy = $.proxy,
        now = $.now,
        extend = $.extend,
        getOffset = kendo.getOffset,
        draggables = {},
        dropTargets = {},
        dropAreas = {},
        lastDropTarget,
        OS = support.mobileOS,
        invalidZeroEvents = OS && OS.android,
        mobileChrome = (invalidZeroEvents && OS.browser == "chrome"),
        START_EVENTS = "mousedown",
        MOVE_EVENTS = "mousemove",
        END_EVENTS = "mouseup mouseleave",
        KEYUP = "keyup",
        CHANGE = "change",

        // Draggable events
        DRAGSTART = "dragstart",
        DRAG = "drag",
        DRAGEND = "dragend",
        DRAGCANCEL = "dragcancel",

        // DropTarget events
        DRAGENTER = "dragenter",
        DRAGLEAVE = "dragleave",
        DROP = "drop",

        // Event namespace
        NS = ".kendoDrag",

        // Drag events
        START = "start",
        MOVE = "move",
        END = "end",
        CANCEL = "cancel",
        TAP = "tap";

    if (support.touch) {
        START_EVENTS = "touchstart";
        MOVE_EVENTS = "touchmove";
        END_EVENTS = "touchend touchcancel";
    }

    if(pointers) {
        START_EVENTS = "MSPointerDown";
        MOVE_EVENTS = "MSPointerMove";
        END_EVENTS = "MSPointerUp MSPointerCancel";
    }

    function contains(parent, child) {
        try {
            return $.contains(parent, child) || parent == child;
        } catch (e) {
            return false;
        }
    }

    function elementUnderCursor(e) {
        if (mobileChrome) {
            return document.elementFromPoint(e.x.screen, e.y.screen);
        } else {
            return document.elementFromPoint(e.x.client, e.y.client);
        }
    }

    function numericCssPropery(element, property) {
        return parseInt(element.css(property), 10) || 0;
    }

    function within(value, range) {
        return Math.min(Math.max(value, range.min), range.max);
    }

    function containerBoundaries(container, element) {
        var offset = container.offset(),
            minX = offset.left + numericCssPropery(container, "borderLeftWidth") + numericCssPropery(container, "paddingLeft"),
            minY = offset.top + numericCssPropery(container, "borderTopWidth") + numericCssPropery(container, "paddingTop"),
            maxX = minX + container.width() - element.outerWidth(true),
            maxY = minY + container.height() - element.outerHeight(true);

        return {
            x: { min: minX, max: maxX },
            y: { min: minY, max: maxY }
        };
    }

    function preventTrigger(e) {
        e.preventDefault();

        var target = $(e.target),   // Determine the correct parent to receive the event and bubble.
            parent = target.closest(".k-widget").parent();

        if (!parent[0]) {
            parent = target.parent();
        }

        parent.trigger(e.type);
    }

    function checkTarget(target, targets, areas) {
        var theTarget, theFilter, i = 0,
            targetLen = targets && targets.length,
            areaLen = areas && areas.length;

        while (target && target.parentNode) {
            for (i = 0; i < targetLen; i ++) {
                theTarget = targets[i];
                if (theTarget.element[0] === target) {
                    return { target: theTarget, targetElement: target };
                }
            }

            for (i = 0; i < areaLen; i ++) {
                theFilter = areas[i];
                if (support.matchesSelector.call(target, theFilter.options.filter)) {
                    return { target: theFilter, targetElement: target };
                }
            }

            target = target.parentNode;
        }

        return undefined;
    }

    var DragAxis = Class.extend({
        init: function(axis, location, timeStamp) {
            var that = this,
                offset = location["page" + axis];

            that.axis = axis;
            that.startLocation = that.location = offset;
            that.client = location["client" + axis];
            that.screen = location["screen" + axis];
            that.velocity = that.delta = 0;
            that.timeStamp = timeStamp;
        },

        move: function(location, timeStamp) {
            var that = this,
                offset = location["page" + that.axis];

            if (!offset && invalidZeroEvents) {
                return;
            }

            that.delta = offset - that.location;
            that.location = offset;
            that.client = location["client" + that.axis];
            that.screen = location["screen" + that.axis];
            that.initialDelta = offset - that.startLocation;
            that.velocity = that.delta / (timeStamp - that.timeStamp);
            that.timeStamp = timeStamp;
        }
    });

    var Touch = Class.extend({
        init: function(drag, target, location) {
            var that = this,
                timestamp = now();

            that.moved = false;
            that.finished = false;
            that.eventHandler = new DragEventHandler(drag.surface, drag);
            that.x = new DragAxis("X", location, timestamp);
            that.y = new DragAxis("Y", location, timestamp);
            that.drag = drag;
            that.target = target;
        },

        dispose: function() {
            this.eventHandler.destroy();
            this.finished = true;
            delete this.drag.touch;
        },

        skip: function() {
            this.dispose();
        },

        start: function(e) {
           this.startTime = now;
           this.moved = true;
           this.trigger(START, e);
        },

        move: function(e, location) {
            var that = this,
                timestamp = now();

            that.x.move(location, timestamp);
            that.y.move(location, timestamp);

            if (!that.moved) {
                if (that._withinIgnoreThreshold()) {
                    return;
                }

                if (!Drag.captured) {
                    that.start(e);
                } else {
                    return that.dispose();
                }
            }

            // Event handlers may cancel the drag in the START event handler, hence the double check for pressed.
            if (!that.finished) {
                that.trigger(MOVE, e);
            }
        },

        end: function(e) {
            var that = this;
            if (that.moved) {
                that.trigger(END, e);
            } else {
                that.trigger(TAP, e);
            }

            that.dispose();
        },

        trigger: function(name, e) {
            var that = this,
                data = {
                    touch: that,
                    x: that.x,
                    y: that.y,
                    target: that.target,
                    startTime: that.startTime,
                    event: e
                };

            if(that.drag.trigger(name, data)) {
                e.preventDefault();
            }
        },

        _withinIgnoreThreshold: function() {
            var xDelta = this.x.initialDelta,
                yDelta = this.y.initialDelta;

            return Math.sqrt(xDelta * xDelta + yDelta * yDelta) <= this.drag.threshold;
        },

    });

    var DragEventHandler = Class.extend({
       init: function(surface, drag) {
           var that = this,
               map = {};

            map[MOVE_EVENTS] = proxy(drag._move, drag);
            map[END_EVENTS] = proxy(drag._end, drag);

            surface.on(map);

            extend(that, {
                map: map,
                surface: surface
            });
       },

       destroy: function() {
           this.surface.off(this.map);
       }
    });

    var Drag = Observable.extend({
        init: function(element, options) {
            var that = this,
                filter,
                preventIfMoving;

            options = options || {};
            filter = that.filter = options.filter;
            that.threshold = options.threshold || 0;

            element = $(element);
            Observable.fn.init.call(that);

            extend(that, {
                element: element,
                surface: options.global ? SURFACE : options.surface || element,
                stopPropagation: options.stopPropagation,
                pressed: false
            });

            element
                .on(START_EVENTS + NS, filter, proxy(that._start, that))
                .on("dragstart" + NS, filter, kendo.preventDefault);

            if (pointers) {
                element.css("-ms-touch-action", "pinch-zoom double-tap-zoom");
            }

            if (!options.allowSelection) {
                var args = ["mousedown" + NS + " selectstart" + NS, filter, preventTrigger];

                if (filter instanceof $) {
                    args.splice(2, 0, null);
                }

                element.on.apply(element, args);
            }

            if (support.eventCapture) {
                preventIfMoving = function(e) {
                    if (that._isMoved()) {
                        e.preventDefault();
                    }
                };

                that.surface[0].addEventListener(support.mouseup, preventIfMoving, true);
            }

            that.bind([
            TAP,
            START,
            MOVE,
            END,
            CANCEL], options);
        },

        destroy: function() {
            this.element.off(NS);
            if (this.touch) {
                this.touch.dispose();
            }
        },

        capture: function() {
            Drag.captured = true;
        },

        cancel: function() {
            this.touch.dispose();
            this.trigger(CANCEL);
        },

        _isMoved: function() {
            return this.touch.moved;
        },

        _isPressed: function() {
            return this.touch;
        },

        _start: function(e) {
            var that = this,
                filter = that.filter,
                originalEvent = e.originalEvent,
                target,
                touch,
                location = e;

            if (that._isPressed()) { return; }

            if (filter) {
                target = $(e.target).is(filter) ? $(e.target) : $(e.target).closest(filter);
            } else {
                target = that.element;
            }

            if (!target.length) {
                return;
            }

            that.currentTarget = e.currentTarget;

            if (that.stopPropagation) {
                e.stopPropagation();
            }

            if (support.touch) {
                touch = originalEvent.changedTouches[0];
                that.touchID = touch.identifier;
                location = touch;
            }

            if (pointers) {
                that.touchID = originalEvent.pointerId;
                location = originalEvent;
            }

            that.touch = new Touch(that, target, location);
            Drag.captured = false;
        },

        _move: function(e) {
            var that = this;

            if (!that._isPressed()) { return; }

            that._withEvent(e, function(location) {
                that.touch.move(e, location);
            });
        },

        _end: function(e) {
            var that = this;

            if (!that._isPressed()) { return; }

            that._withEvent(e, function() {
                that.touch.end(e);
            });
        },

        _withEvent: function(e, callback) {
            var that = this,
                touchID = that.touchID,
                originalEvent = e.originalEvent,
                touches,
                idx;

            if (support.touch) {
                touches = originalEvent.changedTouches;
                idx = touches.length;

                while (idx) {
                    idx --;
                    if (touches[idx].identifier === touchID) {
                        return callback(touches[idx]);
                    }
                }
            }
            else if (pointers) {
                if (touchID === originalEvent.pointerId) {
                    return callback(originalEvent);
                }
            } else {
                return callback(e);
            }
        }
    });

    var Tap = Observable.extend({
        init: function(element, options) {
            var that = this,
                domElement = element[0];

            that.capture = false;
            domElement.addEventListener(START_EVENTS, proxy(that._press, that), true);
            $.each(END_EVENTS.split(" "), function() {
                domElement.addEventListener(this, proxy(that._release, that), true);
            });

            Observable.fn.init.call(that);

            that.bind(["press", "release"], options || {});
        },

        _press: function(e) {
            var that = this;
            that.trigger("press");
            if (that.capture) {
                e.preventDefault();
            }
        },

        _release: function(e) {
            var that = this;
            that.trigger("release");

            if (that.capture) {
                e.preventDefault();
                that.cancelCapture();
            }
        },

        captureNext: function() {
            this.capture = true;
        },

        cancelCapture: function() {
            this.capture = false;
        }
    });

    var PaneDimension = Observable.extend({
        init: function(options) {
            var that = this;
            Observable.fn.init.call(that);

            $.extend(that, options);

            that.max = 0;
            that._forceEnabled = false;

            if (that.horizontal) {
                that.measure = "width";
                that.scrollSize = "scrollWidth";
                that.axis = "x";
            } else {
                that.measure = "height";
                that.scrollSize = "scrollHeight";
                that.axis = "y";
            }
        },

        outOfBounds: function(offset) {
            return  offset > this.max || offset < this.min;
        },

        present: function() {
            return this._forceEnabled || (this.max - this.min);
        },

        forceEnabled: function() {
            this._forceEnabled = true;
        },

        getSize: function() {
            return this.container[this.measure]();
        },

        getTotal: function() {
            return this.element[0][this.scrollSize];
        },

        update: function(silent) {
            var that = this;

            that.size = that.getSize();
            that.total = that.getTotal();
            that.min = Math.min(that.max, that.size - that.total);
            if (!silent) {
                that.trigger(CHANGE, that);
            }
        }
    });

    var PaneDimensions = Observable.extend({
        init: function(options) {
            var that = this,
                refresh = proxy(that.refresh, that);

            Observable.fn.init.call(that);

            that.x = new PaneDimension(extend({horizontal: true}, options));
            that.y = new PaneDimension(extend({horizontal: false}, options));

            that.bind(CHANGE, options);

            kendo.onResize(refresh);
        },

        present: function() {
            return this.x.present() || this.y.present();
        },

        refresh: function() {
            this.x.update();
            this.y.update();
            this.trigger(CHANGE);
        }
    });

    var PaneAxis = Observable.extend({
        init: function(options) {
            var that = this;
            extend(that, options);
            Observable.fn.init.call(that);
        },

        dragMove: function(delta) {
            var that = this,
                dimension = that.dimension,
                axis = that.axis,
                movable = that.movable,
                position = movable[axis] + delta;

            if (!dimension.present()) {
                return;
            }

            if ((position < dimension.min && delta < 0) || (position > dimension.max && delta > 0)) {
                delta *= that.resistance;
            }

            movable.translateAxis(axis, delta);
            that.trigger(CHANGE, that);
        }
    });

    var Pane = Class.extend({
        init: function(options) {
            var that = this,
                x,
                y,
                resistance;

            extend(that, {elastic: true}, options);

            resistance = that.elastic ? 0.5 : 0;

            that.x = x = new PaneAxis({
                axis: "x",
                dimension: that.dimensions.x,
                resistance: resistance,
                movable: that.movable
            });

            that.y = y = new PaneAxis({
                axis: "y",
                dimension: that.dimensions.y,
                resistance: resistance,
                movable: that.movable
            });

            that.drag.bind(["move", "end"], {
                move: function(e) {
                    if (x.dimension.present() || y.dimension.present()) {
                        x.dragMove(e.x.delta);
                        y.dragMove(e.y.delta);
                        e.preventDefault();
                    } else {
                        e.touch.skip();
                    }
                },

                end: function(e) {
                    e.preventDefault();
                }
            });
        }
    });

    var TRANSFORM_STYLE = support.transitions.prefix + "Transform",
        round = Math.round,
        translate;

    if (support.hasHW3D) {
        translate = function(x, y) {
            return "translate3d(" + round(x) + "px," + round(y) +"px,0)";
        };
    } else {
        translate = function(x, y) {
            return "translate(" + round(x) + "px," + round(y) +"px)";
        };
    }

    var Movable = Observable.extend({
        init: function(element) {
            var that = this;

            Observable.fn.init.call(that);

            that.element = $(element);
            that.x = 0;
            that.y = 0;
            that._saveCoordinates(translate(that.x, that.y));
        },

        translateAxis: function(axis, by) {
            this[axis] += by;
            this.refresh();
        },

        translate: function(coordinates) {
            this.x += coordinates.x;
            this.y += coordinates.y;
            this.refresh();
        },

        moveAxis: function(axis, value) {
            this[axis] = value;
            this.refresh();
        },

        moveTo: function(coordinates) {
            extend(this, coordinates);
            this.refresh();
        },

        refresh: function() {
            var that = this,
                newCoordinates = translate(that.x, that.y);

            if (newCoordinates != that.coordinates) {
                that.element[0].style[TRANSFORM_STYLE] = newCoordinates;
                that._saveCoordinates(newCoordinates);
                that.trigger(CHANGE);
            }
        },

        _saveCoordinates: function(coordinates) {
            this.coordinates = coordinates;
        }
    });

    var DropTarget = Widget.extend({
        init: function(element, options) {
            var that = this;

            Widget.fn.init.call(that, element, options);

            var group = that.options.group;

            if (!(group in dropTargets)) {
                dropTargets[group] = [ that ];
            } else {
                dropTargets[group].push( that );
            }
        },

        events: [
            DRAGENTER,
            DRAGLEAVE,
            DROP
        ],

        options: {
            name: "DropTarget",
            group: "default"
        },

        _trigger: function(eventName, e) {
            var that = this,
                draggable = draggables[that.options.group];

            if (draggable) {
                return that.trigger(eventName, extend({}, e.event, {
                           draggable: draggable,
                           dropTarget: e.dropTarget
                       }));
            }
        },

        _over: function(e) {
            this._trigger(DRAGENTER, e);
        },

        _out: function(e) {
            this._trigger(DRAGLEAVE, e);
        },

        _drop: function(e) {
            var that = this,
                draggable = draggables[that.options.group];

            if (draggable) {
                draggable.dropped = !that._trigger(DROP, e);
            }
        }
    });

    var DropTargetArea = DropTarget.extend({
        init: function(element, options) {
            var that = this;

            Widget.fn.init.call(that, element, options);

            var group = that.options.group;

            if (!(group in dropAreas)) {
                dropAreas[group] = [ that ];
            } else {
                dropAreas[group].push( that );
            }
        },

        options: {
            name: "DropTargetArea",
            group: "default",
            filter: null
        }
    });

    var Draggable = Widget.extend({
        init: function (element, options) {
            var that = this;

            Widget.fn.init.call(that, element, options);

            that.drag = new Drag(that.element, {
                global: true,
                stopPropagation: true,
                filter: that.options.filter,
                threshold: that.options.distance,
                start: proxy(that._start, that),
                move: proxy(that._drag, that),
                end: proxy(that._end, that),
                cancel: proxy(that._cancel, that)
            });

            that._destroyHandler = proxy(that._destroy, that);
            that.captureEscape = function(e) {
                if (e.keyCode === kendo.keys.ESC) {
                    that._trigger(DRAGCANCEL, {event: e});
                    that.drag.cancel();
                }
            };
        },

        events: [
            DRAGSTART,
            DRAG,
            DRAGEND,
            DRAGCANCEL
        ],

        options: {
            name: "Draggable",
            distance: 5,
            group: "default",
            cursorOffset: null,
            axis: null,
            container: null,
            dropped: false
        },

        _start: function(e) {
            var that = this,
                options = that.options,
                container = options.container,
                hint = options.hint;

            that.currentTarget = e.target;
            that.currentTargetOffset = getOffset(that.currentTarget);

            if (hint) {
                that.hint = $.isFunction(hint) ? $(hint(that.currentTarget)) : hint;

                var offset = getOffset(that.currentTarget);
                that.hintOffset = offset;

                that.hint.css( {
                    position: "absolute",
                    zIndex: 20000, // the Window's z-index is 10000 and can be raised because of z-stacking
                    left: offset.left,
                    top: offset.top
                })
                .appendTo(document.body);
            }

            draggables[options.group] = that;

            that.dropped = false;

            if (container) {
                that.boundaries = containerBoundaries(container, that.hint);
            }

            if (that._trigger(DRAGSTART, e)) {
                that.drag.cancel();
                that._destroy();
            }

            $(document).on(KEYUP, that.captureEscape);
        },

        updateHint: function(e) {
            var that = this,
                coordinates,
                options = that.options,
                boundaries = that.boundaries,
                axis = options.axis,
                cursorOffset = that.options.cursorOffset;

            if (cursorOffset) {
               coordinates = { left: e.x.location + cursorOffset.left, top: e.y.location + cursorOffset.top };
            } else {
               that.hintOffset.left += e.x.delta;
               that.hintOffset.top += e.y.delta;
               coordinates = $.extend({}, that.hintOffset);
            }

            if (boundaries) {
                coordinates.top = within(coordinates.top, boundaries.y);
                coordinates.left = within(coordinates.left, boundaries.x);
            }

            if (axis === "x") {
                delete coordinates.top;
            } else if (axis === "y") {
                delete coordinates.left;
            }

            that.hint.css(coordinates);
        },

        _drag: function(e) {
            var that = this;

            e.preventDefault();

            that._withDropTarget(e, function(target, targetElement) {
                if (!target) {
                    if (lastDropTarget) {
                        lastDropTarget._trigger(DRAGLEAVE, extend(e, { dropTarget: $(lastDropTarget.targetElement) }));
                        lastDropTarget = null;
                    }
                    return;
                }

                if (lastDropTarget) {
                    if (targetElement === lastDropTarget.targetElement) {
                        return;
                    }

                    lastDropTarget._trigger(DRAGLEAVE, extend(e, { dropTarget: $(lastDropTarget.targetElement) }));
                }

                target._trigger(DRAGENTER, extend(e, { dropTarget: $(targetElement) }));
                lastDropTarget = extend(target, { targetElement: targetElement });
            });

            that._trigger(DRAG, e);

            if (that.hint) {
                that.updateHint(e);
            }
        },

        _end: function(e) {
            var that = this;

            that._withDropTarget(e, function(target, targetElement) {
                if (target) {
                    target._drop(extend({}, e, { dropTarget: $(targetElement) }));
                    lastDropTarget = null;
                }
            });

            that._trigger(DRAGEND, e);
            that._cancel(e.event);
        },

        _cancel: function(e) {
            var that = this;

            if (that.hint && !that.dropped) {
                that.hint.animate(that.currentTargetOffset, "fast", that._destroyHandler);
            } else {
                that._destroy();
            }
        },

        _trigger: function(eventName, e) {
            var that = this;

            return that.trigger(
                eventName, extend(
                {},
                e.event,
                {
                    x: e.x,
                    y: e.y,
                    currentTarget: that.currentTarget,
                    dropTarget: e.dropTarget
                }
            ));
        },

        _withDropTarget: function(e, callback) {
            var that = this,
                target, result,
                options = that.options,
                targets = dropTargets[options.group],
                areas = dropAreas[options.group];

            if (targets && targets.length || areas && areas.length) {

                target = elementUnderCursor(e);

                if (that.hint && contains(that.hint[0], target)) {
                    that.hint.hide();
                    target = elementUnderCursor(e);
                    that.hint.show();
                }

                result = checkTarget(target, targets, areas);

                if (result) {
                    callback(result.target, result.targetElement);
                } else {
                    callback();
                }
            }
        },

        destroy: function() {
            var that = this;

            Widget.fn.destroy.call(that);

            that._destroy();

            that.drag.destroy();
        },

        _destroy: function() {
            var that = this;

            if (that.hint) {
                that.hint.remove();
            }

            delete draggables[that.options.group];

            that.trigger("destroy");
            $(document).off(KEYUP, that.captureEscape);
        }
    });

    kendo.ui.plugin(DropTarget);
    kendo.ui.plugin(DropTargetArea);
    kendo.ui.plugin(Draggable);
    kendo.Drag = Drag;
    kendo.Tap = Tap;
    kendo.containerBoundaries = containerBoundaries;

    extend(kendo.ui, {
        Pane: Pane,
        PaneDimensions: PaneDimensions,
        Movable: Movable
    });

 })(jQuery);
