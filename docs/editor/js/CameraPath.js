// ── CameraPath.js ─────────────────────────────────────────────────────────────
// The viewport overlay for hand-editing a camera's motion (see guides/CAMERA_PATHS.md).
// For the selected shot camera (or, failing that, the camera the viewport is looking
// through) it draws the track's path, a tick every second, a handle at each KEY, and
// for the selected key a handle on its aim point. Handles drag with the viewport
// gizmo and commit as ONE undoable SetTimelineCommand on release.
//
// Drawn in the helpers scene, so it shows only in the Edit Camera view, and hides with
// the "hide cameras" button / View > Camera Helpers.

import * as THREE from 'three';
import { cameraKeys, samplePath, makeCurve } from './intelligence/splineTrack.js';
import { TimelineModel } from './intelligence/timeline.js';
import { SetTimelineCommand } from './commands/SetTimelineCommand.js';

const PATH = 0x35d0ff, KEY = 0xffffff, SEL = 0x7dff4a, LOOK = 0xff3df2, TICK = 0x9fe9ff;
const HANDLE_PX = 0.013; // handle radius as a fraction of the distance to the viewing camera

const isVec3 = v => Array.isArray( v ) && v.length === 3;
const r4 = v => Math.round( v * 1e4 ) / 1e4;

export class CameraPath {

	constructor( editor, { sceneHelpers, transformControls, render, container, getControls } ) {

		this.editor = editor;
		this.transformControls = transformControls;
		this.render = render;
		this.getControls = getControls;

		this.group = new THREE.Group();
		this.group.name = '__cameraPath';
		sceneHelpers.add( this.group );

		this.proxy = new THREE.Object3D();
		this.proxy.name = '__cameraPathProxy';
		sceneHelpers.add( this.proxy );

		this.handles = [];
		this.selectedKeyId = null;
		this.selectedKind = null; // 'key' | 'look'
		this.dragging = false;
		this.camera = null;
		this.trackTarget = null;
		this._priorMode = null;
		this._live = null; // events while a drag is in flight
		this._raycaster = new THREE.Raycaster();
		this._mouse = new THREE.Vector2();

		this.label = document.createElement( 'div' );
		this.label.style.cssText = 'position:absolute;display:none;pointer-events:none;padding:2px 6px;border-radius:3px;font:11px sans-serif;color:#fff;background:rgba(20,20,20,0.85);white-space:nowrap;z-index:5;';
		container.appendChild( this.label );

		const refresh = () => this.scheduleRebuild();
		const s = editor.signals;
		s.timelineChanged.add( refresh );
		s.objectSelected.add( () => { this.releaseHandle(); refresh(); } );
		s.viewportCameraChanged.add( refresh );
		s.showHelpersChanged.add( refresh );
		s.cameraAdded.add( refresh );
		s.cameraRemoved.add( refresh );
		s.editorCleared.add( () => { this.releaseHandle(); refresh(); } );

		// Delete / Backspace removes the selected KEY, never the camera behind it.
		document.addEventListener( 'keydown', event => {

			if ( ! this.selectedKeyId || this.dragging ) return;
			if ( event.key !== 'Delete' && event.key !== 'Backspace' ) return;
			const t = event.target;
			if ( t && ( t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable ) ) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			this.deleteSelected();

		}, true );

	}

	// ── which track ──────────────────────────────────────────────────────────

	currentCamera() {

		const e = this.editor;
		if ( e.selected && e.selected.isCamera && e.selected !== e.camera ) return e.selected;
		const v = e.viewportCamera;
		if ( v && v !== e.camera && v.isCamera ) return v;
		return null;

	}

	selectorsFor( object ) {

		const out = [];
		if ( object.userData && object.userData.label ) out.push( '#' + object.userData.label );
		if ( object.name ) out.push( '#' + object.name );
		out.push( object.uuid );
		return out;

	}

	trackFor( camera ) {

		const tl = this.editor.timeline;
		if ( ! tl || ! camera ) return null;
		for ( const sel of this.selectorsFor( camera ) ) {

			const t = tl.tracks.find( t => t.target === sel );
			if ( t ) return t;

		}
		return null;

	}

	// ── drawing ──────────────────────────────────────────────────────────────

	scheduleRebuild() {

		if ( this._pending ) return;
		this._pending = true;
		Promise.resolve().then( () => { this._pending = false; if ( ! this.dragging ) this.rebuild(); } );

	}

	clear() {

		for ( const c of [ ...this.group.children ] ) {

			this.group.remove( c );
			if ( c.geometry ) c.geometry.dispose();
			if ( c.material ) c.material.dispose();

		}
		this.handles = [];

	}

	rebuild( eventsOverride = null ) {

		this.clear();
		this.camera = this.currentCamera();
		const track = this.camera ? this.trackFor( this.camera ) : null;
		this.trackTarget = track ? track.target : null;
		this.keyCount = 0;
		const hidden = this.editor.helperStates && this.editor.helperStates.cameraHelpers === false;
		if ( ! track || hidden ) { this.label.style.display = 'none'; this.render(); return; }

		const events = eventsOverride || track.events;
		const keys = cameraKeys( events );
		this.keyCount = keys.length;
		if ( keys.length === 0 ) { this.render(); return; }
		const spline = !! track.spline;

		// path
		const pts = samplePath( events, spline, 0.1 ).map( p => new THREE.Vector3( ...p ) );
		if ( pts.length > 1 ) {

			const line = new THREE.Line( new THREE.BufferGeometry().setFromPoints( pts ), new THREE.LineBasicMaterial( { color: PATH, depthTest: false, transparent: true } ) );
			line.renderOrder = 998;
			this.group.add( line );

		}

		// a tick each second (where the camera is, not just the keys)
		const t0 = keys[ 0 ].time, t1 = keys[ keys.length - 1 ].time;
		const at = this.positionAt( keys, spline );
		const ticks = [];
		for ( let t = Math.ceil( t0 ); t <= t1; t ++ ) ticks.push( new THREE.Vector3( ...at( t ) ) );
		if ( ticks.length ) {

			const tp = new THREE.Points( new THREE.BufferGeometry().setFromPoints( ticks ), new THREE.PointsMaterial( { color: TICK, size: 5, sizeAttenuation: false, depthTest: false, transparent: true } ) );
			tp.renderOrder = 998;
			this.group.add( tp );

		}

		// handles
		const sphere = new THREE.SphereGeometry( 1, 12, 8 );
		const dense = keys.length > 40;
		keys.forEach( ( k, i ) => {

			const sel = k.id === this.selectedKeyId;
			const m = new THREE.Mesh( sphere, new THREE.MeshBasicMaterial( { color: sel && this.selectedKind === 'key' ? SEL : KEY, depthTest: false, transparent: true, opacity: dense && ! sel ? 0.55 : 1 } ) );
			m.position.set( ...k.position );
			m.renderOrder = 999;
			m.userData.handle = { kind: 'key', id: k.id, index: i, time: k.time, base: dense && ! sel ? 0.55 : 1 };
			this.group.add( m );
			this.handles.push( m );

		} );

		// aim points: a faint line from every key (few keys), a handle for the selected one
		const showLines = keys.length <= 30;
		keys.forEach( k => {

			if ( ! isVec3( k.lookAt ) ) return;
			const sel = k.id === this.selectedKeyId;
			if ( ! sel && ! showLines ) return;
			const l = new THREE.Line( new THREE.BufferGeometry().setFromPoints( [ new THREE.Vector3( ...k.position ), new THREE.Vector3( ...k.lookAt ) ] ), new THREE.LineDashedMaterial( { color: LOOK, dashSize: 0.02, gapSize: 0.015, depthTest: false, transparent: true, opacity: sel ? 1 : 0.35 } ) );
			l.computeLineDistances();
			l.renderOrder = 997;
			this.group.add( l );
			if ( sel ) {

				const d = new THREE.Mesh( new THREE.OctahedronGeometry( 1 ), new THREE.MeshBasicMaterial( { color: this.selectedKind === 'look' ? SEL : LOOK, depthTest: false, transparent: true } ) );
				d.position.set( ...k.lookAt );
				d.renderOrder = 999;
				d.userData.handle = { kind: 'look', id: k.id, base: 1 };
				this.group.add( d );
				this.handles.push( d );

			}

		} );

		this.group.updateMatrixWorld( true );
		this.render();

	}

	/** position at time t, matching how the track plays */
	positionAt( keys, spline ) {

		if ( spline ) { const c = makeCurve( keys ); return t => c.at( t ).position; }
		return t => {

			if ( t <= keys[ 0 ].time ) return keys[ 0 ].position;
			for ( let i = 1; i < keys.length; i ++ ) {

				if ( t <= keys[ i ].time ) {

					const a = keys[ i - 1 ], b = keys[ i ], u = ( t - a.time ) / Math.max( 1e-6, b.time - a.time );
					return a.position.map( ( v, d ) => v + ( b.position[ d ] - v ) * u );

				}

			}
			return keys[ keys.length - 1 ].position;

		};

	}

	/** keep handles a constant size on screen; called every render */
	updateScales( viewCamera ) {

		if ( ! this.handles.length ) { this.label.style.display = 'none'; return; }
		const p = viewCamera.getWorldPosition( new THREE.Vector3() );
		for ( const h of this.handles ) {

			const d = p.distanceTo( h.position );
			h.scale.setScalar( Math.max( 1e-4, d * HANDLE_PX * ( h.userData.handle.kind === 'look' ? 0.9 : ( h.userData.handle.base < 1 ? 0.6 : 1 ) ) ) );

		}
		this.group.updateMatrixWorld( true );

		const sel = this.handles.find( h => h.userData.handle.id === this.selectedKeyId && h.userData.handle.kind === ( this.selectedKind || 'key' ) );
		if ( sel && this.selectedKeyId ) {

			const v = sel.position.clone().project( viewCamera );
			const dom = this.label.parentElement;
			if ( v.z < 1 && dom ) {

				this.label.style.display = 'block';
				this.label.style.left = ( ( v.x + 1 ) / 2 * dom.clientWidth + 12 ) + 'px';
				this.label.style.top = ( ( 1 - v.y ) / 2 * dom.clientHeight - 24 ) + 'px';
				this.label.textContent = this.describe( sel.userData.handle );
				return;

			}

		}
		this.label.style.display = 'none';

	}

	describe( h ) {

		const keys = cameraKeys( this.editor.timeline.track( this.trackTarget ).events );
		const k = keys.find( k => k.id === h.id );
		const i = keys.indexOf( k );
		return ( h.kind === 'look' ? 'aim ' : 'key ' ) + ( i + 1 ) + '/' + keys.length + ' · ' + ( k ? k.time.toFixed( 2 ) : '?' ) + 's';

	}

	// ── picking + dragging ───────────────────────────────────────────────────

	/** Called on a viewport click (normalized 0..1 point). True when a handle took it. */
	pick( point, viewCamera ) {

		if ( ! this.handles.length ) return false;
		this._mouse.set( point.x * 2 - 1, - point.y * 2 + 1 );
		this._raycaster.setFromCamera( this._mouse, viewCamera );
		this.group.updateMatrixWorld( true );
		const hit = this._raycaster.intersectObjects( this.handles, false )[ 0 ];
		if ( ! hit ) { this.releaseHandle(); return false; }

		const h = hit.object.userData.handle;
		this.selectedKeyId = h.id;
		this.selectedKind = h.kind;
		this.proxy.position.copy( hit.object.position );
		this.proxy.updateMatrixWorld( true );
		const tc = this.transformControls;
		if ( this._priorMode === null ) this._priorMode = tc.getMode();
		tc.setMode( 'translate' );
		tc.attach( this.proxy );
		this.editor.signals.cameraPathChanged.dispatch();
		this.rebuild();
		return true;

	}

	/** Drop the handle selection and give the gizmo back. */
	releaseHandle() {

		if ( this.selectedKeyId === null && this.transformControls.object !== this.proxy ) return;
		this.selectedKeyId = null;
		this.selectedKind = null;
		if ( this.transformControls.object === this.proxy ) this.transformControls.detach();
		if ( this._priorMode ) { this.transformControls.setMode( this._priorMode ); this._priorMode = null; }
		this.editor.signals.cameraPathChanged.dispatch();
		this.scheduleRebuild();

	}

	beginDrag() {

		const track = this.editor.timeline.track( this.trackTarget );
		if ( ! track || ! this.selectedKeyId ) return false;
		this.dragging = true;
		this._live = JSON.parse( JSON.stringify( track.events ) );
		const c = this.getControls();
		if ( c ) c.enabled = false;
		return true;

	}

	_apply( events, pos ) {

		const e = events.find( e => e.id === this.selectedKeyId );
		if ( ! e ) return;
		const p = pos.map( r4 );
		if ( this.selectedKind === 'look' ) e.args.props.lookAt = p;
		else e.args.props.to.position = p;

	}

	dragMove() {

		if ( ! this.dragging ) return;
		this.proxy.updateMatrixWorld( true );
		this._apply( this._live, this.proxy.position.toArray() );
		// redraw the path live, keeping the dragged handle where the gizmo is
		this.rebuild( this._live );
		this.render();

	}

	endDrag() {

		if ( ! this.dragging ) return;
		this.dragging = false;
		const c = this.getControls();
		if ( c ) c.enabled = true;
		// deep copy: TimelineModel copies events shallowly, and the undo snapshot must not change
		const model = TimelineModel.fromJSON( JSON.parse( JSON.stringify( this.editor.timeline.toJSON() ) ) );
		const track = model.track( this.trackTarget );
		if ( track ) {

			this._apply( track.events, this.proxy.position.toArray() );
			this.editor.execute( new SetTimelineCommand( this.editor, model.toJSON(), this.selectedKind === 'look' ? 'Move camera aim point' : 'Move camera key' ) );

		}
		this._live = null;
		this.rebuild();

	}

	deleteSelected() {

		if ( ! this.selectedKeyId ) return;
		const id = this.selectedKeyId;
		this.releaseHandle();
		const model = TimelineModel.fromJSON( this.editor.timeline.toJSON() );
		const track = model.track( this.trackTarget );
		if ( ! track ) return;
		if ( cameraKeys( track.events ).length <= 1 ) return; // keep at least one key
		track.events = track.events.filter( e => e.id !== id );
		this.editor.execute( new SetTimelineCommand( this.editor, model.toJSON(), 'Delete camera key' ) );

	}

}
