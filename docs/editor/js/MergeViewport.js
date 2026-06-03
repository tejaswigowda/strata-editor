// ── MergeViewport.js ──────────────────────────────────────────────────────────
// Split-screen viewport for reviewing and resolving scene conflicts.
//
// Layout:
//   ┌───────────────────────────────────────────┐
//   │  title bar  + Close                        │
//   │  ┌──────────────┬──────────────┐           │
//   │  │  LOCAL       │  REMOTE      │  canvas   │
//   │  │  (your edits)│  (GitHub)    │           │
//   │  └──────────────┴──────────────┘           │
//   │  conflict list  (scrollable)               │
//   │  [Accept All Local] [Accept All Remote]    │
//   │  [AI Suggest]       [Apply Merge]          │
//   └───────────────────────────────────────────┘
//
// Color coding (emissive tint on objects):
//   🟢 green  — added locally (local only)
//   🔴 red    — in remote only (removed locally, or remote addition)
//   🟠 orange — in both but modified
//
// Usage:
//   const mv = new MergeViewport(editor, localJSON, remoteJSON, diff);
//   mv.open();

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { diffSummary } from './SceneDiff.js';

const TINT = {
	added:     new THREE.Color( 0x00cc66 ),
	removed:   new THREE.Color( 0xff4444 ),
	modified:  new THREE.Color( 0xff9900 ),
};

export class MergeViewport {

	constructor( editor, localJSON, remoteJSON, diff ) {

		this.editor     = editor;
		this.localJSON  = localJSON;
		this.remoteJSON = remoteJSON;
		this.diff       = diff;

		// Resolution choices: uuid → 'local' | 'remote' | 'both' | 'neither'
		this.resolutions = {};
		this._initResolutions();

		this._dom      = null;
		this._renderer = null;
		this._animId   = null;
		this._camera   = null;
		this._controls = null;
		this._localScene  = null;
		this._remoteScene = null;

	}

	// ── Public ────────────────────────────────────────────────────────────────

	async open() {

		this._dom = this._buildDOM();
		document.body.appendChild( this._dom );

		// Give the DOM time to layout so canvas dimensions are correct
		await new Promise( r => requestAnimationFrame( r ) );
		await this._initRenderer();

		this._buildConflictList();
		this._startLoop();

	}

	close() {

		if ( this._animId ) { cancelAnimationFrame( this._animId ); this._animId = null; }

		if ( this._controls ) { this._controls.dispose(); this._controls = null; }
		if ( this._renderer ) { this._renderer.dispose(); this._renderer = null; }

		if ( this._localScene )  this._disposeScene( this._localScene );
		if ( this._remoteScene ) this._disposeScene( this._remoteScene );

		if ( this._dom ) { this._dom.remove(); this._dom = null; }

	}

	// ── DOM ───────────────────────────────────────────────────────────────────

	_buildDOM() {

		const wrap = document.createElement( 'div' );
		wrap.style.cssText = 'position:fixed;inset:0;z-index:9000;display:flex;flex-direction:column;background:#1a1a1a;color:#eee;font:13px/1.5 monospace;';

		// Title bar
		const bar = document.createElement( 'div' );
		bar.style.cssText = 'display:flex;align-items:center;padding:6px 12px;background:#111;border-bottom:1px solid #333;flex-shrink:0;';
		bar.innerHTML = `
			<span style="flex:1;font-weight:bold;">⚡ Merge Conflict</span>
			<span style="color:#888;font-size:11px;margin-right:12px;">Left = LOCAL &nbsp;|&nbsp; Right = REMOTE (GitHub)</span>
			<span style="color:#aaa;font-size:11px;margin-right:16px;">🟢 added &nbsp; 🔴 removed &nbsp; 🟠 modified</span>
		`;
		const closeBtn = document.createElement( 'button' );
		closeBtn.textContent = '✕ Close';
		closeBtn.style.cssText = 'padding:3px 10px;cursor:pointer;background:#333;color:#eee;border:1px solid #555;border-radius:3px;';
		closeBtn.addEventListener( 'click', () => this.close() );
		bar.appendChild( closeBtn );
		wrap.appendChild( bar );

		// Canvas area
		const canvasWrap = document.createElement( 'div' );
		canvasWrap.style.cssText = 'flex:1;position:relative;overflow:hidden;';

		const canvas = document.createElement( 'canvas' );
		canvas.className = 'merge-canvas';
		canvas.style.cssText = 'width:100%;height:100%;display:block;';
		canvasWrap.appendChild( canvas );

		// Panel labels
		const labelL = document.createElement( 'div' );
		labelL.style.cssText = 'position:absolute;top:8px;left:8px;background:rgba(0,0,0,0.6);padding:2px 8px;border-radius:3px;font-size:11px;pointer-events:none;';
		labelL.textContent = 'LOCAL';
		const labelR = document.createElement( 'div' );
		labelR.style.cssText = 'position:absolute;top:8px;left:50%;margin-left:8px;background:rgba(0,0,0,0.6);padding:2px 8px;border-radius:3px;font-size:11px;pointer-events:none;';
		labelR.textContent = 'REMOTE (GitHub)';
		canvasWrap.appendChild( labelL );
		canvasWrap.appendChild( labelR );
		wrap.appendChild( canvasWrap );

		// Conflict panel
		const panel = document.createElement( 'div' );
		panel.className = 'merge-conflict-panel';
		panel.style.cssText = 'flex-shrink:0;max-height:220px;overflow-y:auto;border-top:1px solid #333;padding:8px 12px;';

		const totalConflicts = this.diff.added.length + this.diff.removed.length + this.diff.modified.length;
		const heading = document.createElement( 'div' );
		heading.style.cssText = 'font-size:11px;color:#aaa;margin-bottom:6px;';
		heading.textContent = totalConflicts === 0
			? '✓ No conflicts — scenes are identical'
			: `${ totalConflicts } conflict${ totalConflicts !== 1 ? 's' : '' } (${ this.diff.added.length } added, ${ this.diff.removed.length } removed, ${ this.diff.modified.length } modified)`;
		panel.appendChild( heading );

		const list = document.createElement( 'div' );
		list.className = 'merge-conflict-list';
		panel.appendChild( list );
		wrap.appendChild( panel );

		// Action bar
		const actions = document.createElement( 'div' );
		actions.style.cssText = 'display:flex;gap:8px;padding:8px 12px;background:#111;border-top:1px solid #333;flex-shrink:0;align-items:center;';

		const mkBtn = ( label, cb, style = '' ) => {

			const b = document.createElement( 'button' );
			b.textContent = label;
			b.style.cssText = `padding:4px 12px;cursor:pointer;border-radius:3px;border:1px solid #555;background:#2a2a2a;color:#eee;${ style }`;
			b.addEventListener( 'click', cb );
			return b;

		};

		actions.appendChild( mkBtn( '← Accept All Local',  () => this._acceptAll( 'local' ) ) );
		actions.appendChild( mkBtn( 'Accept All Remote →',  () => this._acceptAll( 'remote' ) ) );

		const aiBtn = mkBtn( '🤖 AI Suggest', () => this._aiSuggest(), 'background:#1a3a1a;border-color:#2a5a2a;' );
		aiBtn.className = 'merge-ai-btn';
		actions.appendChild( aiBtn );

		const spacer = document.createElement( 'span' );
		spacer.style.flex = '1';
		actions.appendChild( spacer );

		actions.appendChild( mkBtn( '✓ Apply Merge', () => this._applyMerge(), 'background:#1a3a5a;border-color:#2a5a8a;font-weight:bold;' ) );

		wrap.appendChild( actions );

		return wrap;

	}

	// ── Conflict list ─────────────────────────────────────────────────────────

	_buildConflictList() {

		const list = this._dom.querySelector( '.merge-conflict-list' );
		if ( ! list ) return;

		const allConflicts = [
			...this.diff.added.map( e => ( { ...e, status: 'added' } ) ),
			...this.diff.removed.map( e => ( { ...e, status: 'removed' } ) ),
			...this.diff.modified.map( e => ( { ...e, status: 'modified' } ) ),
		];

		if ( allConflicts.length === 0 ) return;

		for ( const entry of allConflicts ) {

			const row = document.createElement( 'div' );
			row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid #2a2a2a;font-size:12px;';

			const icon = { added: '🟢', removed: '🔴', modified: '🟠' }[ entry.status ];
			const label = document.createElement( 'span' );
			label.style.cssText = 'flex:1;';
			label.textContent = `${ icon } "${ entry.name }" (${ entry.status }${ entry.changes.length ? ': ' + entry.changes.join( ', ' ) : '' })`;
			row.appendChild( label );

			if ( entry.status === 'added' ) {

				row.appendChild( this._mkChoice( entry.uuid, 'local',   'Keep',  true ) );
				row.appendChild( this._mkChoice( entry.uuid, 'neither', 'Drop',  false ) );

			} else if ( entry.status === 'removed' ) {

				row.appendChild( this._mkChoice( entry.uuid, 'remote',  'Restore', false ) );
				row.appendChild( this._mkChoice( entry.uuid, 'neither', 'Remove',  true ) );

			} else { // modified

				row.appendChild( this._mkChoice( entry.uuid, 'local',  'Local',  true ) );
				row.appendChild( this._mkChoice( entry.uuid, 'remote', 'Remote', false ) );
				row.appendChild( this._mkChoice( entry.uuid, 'both',   'Both',   false ) );

			}

			list.appendChild( row );

		}

	}

	_mkChoice( uuid, value, label, defaultSelected ) {

		const btn = document.createElement( 'button' );
		btn.dataset.uuid  = uuid;
		btn.dataset.value = value;
		btn.textContent   = label;
		btn.style.cssText = `padding:1px 8px;cursor:pointer;font-size:11px;border-radius:3px;border:1px solid #444;background:${ defaultSelected ? '#2a4a2a' : '#222' };color:#eee;`;

		btn.addEventListener( 'click', () => {

			this.resolutions[ uuid ] = value;
			// Update sibling button styles
			const siblings = btn.parentElement.querySelectorAll( 'button[data-uuid]' );
			siblings.forEach( s => {

				s.style.background = s.dataset.value === this.resolutions[ s.dataset.uuid ] ? '#2a4a2a' : '#222';

			} );

		} );

		return btn;

	}

	_acceptAll( side ) {

		const all = [ ...this.diff.added, ...this.diff.removed, ...this.diff.modified ];

		for ( const entry of all ) {

			if ( side === 'local' ) {

				this.resolutions[ entry.uuid ] = entry.status === 'removed' ? 'neither' : 'local';

			} else {

				this.resolutions[ entry.uuid ] = entry.status === 'added' ? 'neither' : 'remote';

			}

		}

		// Refresh button states
		this._dom.querySelectorAll( 'button[data-uuid]' ).forEach( btn => {

			btn.style.background = btn.dataset.value === this.resolutions[ btn.dataset.uuid ] ? '#2a4a2a' : '#222';

		} );

	}

	// ── Apply merge ───────────────────────────────────────────────────────────

	_applyMerge() {

		const mergedJSON = this._buildMergedJSON();

		if ( ! confirm( 'Apply the merged scene? This will replace the current scene.' ) ) return;

		this.editor.clear();
		this.editor.fromJSON( mergedJSON );
		this.close();

	}

	_buildMergedJSON() {

		// Start from localJSON structure (metadata, images, textures, etc.)
		const merged = JSON.parse( JSON.stringify( this.localJSON ) );

		const localChildren  = this.localJSON.object?.children  ?? [];
		const remoteChildren = this.remoteJSON.object?.children ?? [];
		const remoteByUUID   = new Map( remoteChildren.map( o => [ o.uuid, o ] ) );
		const remoteByName   = new Map( remoteChildren.filter( o => o.name ).map( o => [ o.name, o ] ) );

		const finalChildren = [];

		// Process all local objects
		for ( const local of localChildren ) {

			const res     = this.resolutions[ local.uuid ];
			const isAdded = this.diff.added.some( e => e.uuid === local.uuid );

			if ( isAdded ) {

				if ( res !== 'neither' ) finalChildren.push( local );  // keep local addition

			} else {

				// unchanged or modified
				const isModified = this.diff.modified.some( e => e.uuid === local.uuid );

				if ( isModified && res === 'remote' ) {

					const remote = remoteByUUID.get( local.uuid ) || remoteByName.get( local.name );
					if ( remote ) finalChildren.push( remote );
					else finalChildren.push( local );

				} else if ( isModified && res === 'both' ) {

					finalChildren.push( local );
					const remote = remoteByUUID.get( local.uuid ) || remoteByName.get( local.name );
					if ( remote ) {

						const remCopy = JSON.parse( JSON.stringify( remote ) );
						remCopy.name  = ( remote.name || 'object' ) + '_remote';
						finalChildren.push( remCopy );

					}

				} else {

					finalChildren.push( local );  // keep local (default)

				}

			}

		}

		// Add restored remote objects
		for ( const entry of this.diff.removed ) {

			if ( this.resolutions[ entry.uuid ] === 'remote' ) {

				finalChildren.push( entry.remote );

				// Also bring in any missing geometries/materials
				this._mergeReferences( merged, this.remoteJSON, entry.remote );

			}

		}

		merged.object.children = finalChildren;
		return merged;

	}

	_mergeReferences( target, source, objJSON ) {

		const needed = new Set();
		const walk = o => {

			if ( o.geometry ) needed.add( o.geometry );
			if ( o.material ) needed.add( o.material );
			( o.children || [] ).forEach( walk );

		};

		walk( objJSON );

		for ( const geom of ( source.geometries || [] ) ) {

			if ( needed.has( geom.uuid ) && ! target.geometries.some( g => g.uuid === geom.uuid ) ) {

				target.geometries.push( geom );

			}

		}

		for ( const mat of ( source.materials || [] ) ) {

			if ( needed.has( mat.uuid ) && ! target.materials.some( m => m.uuid === mat.uuid ) ) {

				target.materials.push( mat );

			}

		}

	}

	// ── Renderer ──────────────────────────────────────────────────────────────

	async _initRenderer() {

		const canvasEl = this._dom.querySelector( '.merge-canvas' );
		const w = canvasEl.offsetWidth;
		const h = canvasEl.offsetHeight;

		this._renderer = new THREE.WebGLRenderer( { canvas: canvasEl, antialias: true } );
		this._renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
		this._renderer.setSize( w, h );
		this._renderer.autoClear = false;

		this._camera = new THREE.PerspectiveCamera( 50, ( w / 2 ) / h, 0.01, 1000 );
		this._camera.position.set( 0, 5, 10 );
		this._camera.lookAt( 0, 0, 0 );

		this._controls = new OrbitControls( this._camera, canvasEl );
		this._controls.enableDamping = true;

		this._localScene  = await this._buildScene( this.localJSON,  'local' );
		this._remoteScene = await this._buildScene( this.remoteJSON, 'remote' );

	}

	async _buildScene( json, side ) {

		const loader = new THREE.ObjectLoader();
		let scene;

		try {

			scene = await loader.parseAsync( json );

		} catch {

			scene = new THREE.Scene();

		}

		// Add ambient + directional light so materials render correctly
		if ( ! scene.children.some( c => c.isLight ) ) {

			scene.add( new THREE.AmbientLight( 0xffffff, 0.6 ) );
			const sun = new THREE.DirectionalLight( 0xffffff, 0.8 );
			sun.position.set( 5, 10, 5 );
			scene.add( sun );

		}

		// Apply diff highlight tints
		scene.traverse( obj => {

			if ( ! obj.isMesh ) return;

			// Find which diff entry this object belongs to by UUID or name
			const entry = this._findEntry( obj, side );
			if ( ! entry ) return;

			obj.material = obj.material.clone();
			const col = TINT[ entry.status ];

			if ( col ) {

				if ( obj.material.emissive ) {

					obj.material.emissive.copy( col );
					obj.material.emissiveIntensity = 0.35;

				}

			}

		} );

		// Grey background for visual separation
		scene.background = new THREE.Color( side === 'local' ? 0x1a1f1a : 0x1a1a1f );

		return scene;

	}

	_findEntry( meshObj, side ) {

		const allConflicts = [
			...this.diff.added.map( e => ( { ...e, status: 'added' } ) ),
			...this.diff.removed.map( e => ( { ...e, status: 'removed' } ) ),
			...this.diff.modified.map( e => ( { ...e, status: 'modified' } ) ),
		];

		// Walk up to find a scene-root child
		let o = meshObj;
		while ( o.parent && ! ( o.parent.isScene ) ) o = o.parent;

		return allConflicts.find( e => e.uuid === o.uuid || ( o.name && e.name === o.name ) ) ?? null;

	}

	// ── Render loop ───────────────────────────────────────────────────────────

	_startLoop() {

		const loop = () => {

			this._animId = requestAnimationFrame( loop );
			this._render();

		};

		loop();

	}

	_render() {

		if ( ! this._renderer ) return;

		const canvas = this._renderer.domElement;
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		const dpr = this._renderer.getPixelRatio();
		const W = Math.round( w * dpr );
		const H = Math.round( h * dpr );

		if ( this._renderer.domElement.width !== W || this._renderer.domElement.height !== H ) {

			this._renderer.setSize( w, h );
			this._camera.aspect = ( w / 2 ) / h;
			this._camera.updateProjectionMatrix();

		}

		this._controls.update();

		this._renderer.setScissorTest( true );
		this._renderer.clear();

		// Left — local
		this._renderer.setViewport( 0, 0, W / 2, H );
		this._renderer.setScissor(  0, 0, W / 2, H );
		this._camera.aspect = ( W / 2 ) / H;
		this._camera.updateProjectionMatrix();
		this._renderer.render( this._localScene, this._camera );

		// Right — remote
		this._renderer.setViewport( W / 2, 0, W / 2, H );
		this._renderer.setScissor(  W / 2, 0, W / 2, H );
		this._renderer.render( this._remoteScene, this._camera );

	}

	// ── AI suggest ────────────────────────────────────────────────────────────

	async _aiSuggest() {

		const ai = this.editor.aiEngine;
		if ( ! ai || ! ai.ready ) {

			alert( 'Load an AI model in the JS Shell first.' );
			return;

		}

		const aiBtn = this._dom.querySelector( '.merge-ai-btn' );
		if ( aiBtn ) { aiBtn.disabled = true; aiBtn.textContent = '🤖 Thinking…'; }

		const summary = diffSummary( this.diff );

		const messages = [
			{
				role: 'system',
				content: 'You help resolve 3D scene merge conflicts. Given a diff summary, suggest resolutions for each conflict in plain English — one line per item. Be concise. Format: "ObjectName": keep local / accept remote / keep both.',
			},
			{
				role: 'user',
				content: `Scene diff:\n${ summary }\n\nSuggest resolutions:`,
			},
		];

		try {

			const suggestion = await ai.complete( messages, { maxTokens: 300, temperature: 0.2 } );

			const box = document.createElement( 'div' );
			box.style.cssText = 'margin:6px 12px;padding:8px;background:#0f1f0f;border:1px solid #2a4a2a;border-radius:4px;font-size:11px;white-space:pre-wrap;color:#aaffaa;';
			box.textContent = '🤖 AI suggestions:\n' + suggestion;

			const panel = this._dom.querySelector( '.merge-conflict-panel' );
			if ( panel ) panel.insertBefore( box, panel.firstChild );

		} catch ( err ) {

			alert( 'AI error: ' + err.message );

		} finally {

			if ( aiBtn ) { aiBtn.disabled = false; aiBtn.textContent = '🤖 AI Suggest'; }

		}

	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	_initResolutions() {

		for ( const e of this.diff.added )    this.resolutions[ e.uuid ] = 'local';
		for ( const e of this.diff.removed )  this.resolutions[ e.uuid ] = 'neither';
		for ( const e of this.diff.modified ) this.resolutions[ e.uuid ] = 'local';

	}

	_disposeScene( scene ) {

		scene.traverse( obj => {

			if ( obj.geometry ) obj.geometry.dispose();
			if ( obj.material ) {

				if ( Array.isArray( obj.material ) ) obj.material.forEach( m => m.dispose() );
				else obj.material.dispose();

			}

		} );

	}

}
