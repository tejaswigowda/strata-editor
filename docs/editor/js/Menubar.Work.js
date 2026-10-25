import { UIPanel } from './libs/ui.js';
import { commitSceneToRepo, generateCommitMessage, currentGitSource } from './Menubar.Git.js';
import { recoverPrompt, relativeTime } from './workState.js';

// The "Uncommitted changes" chip in the menubar (with its one-step Commit popover), the
// document-title marker, and the "Recover unsaved changes?" prompt. The state itself
// lives in WorkGuard (editor.work).

const STYLE = `
#work-chip { float: right; position: relative; margin: 7px 10px 0 0; display: none; }
#work-chip.dirty { display: block; }
#work-chip .work-chip-button { display: flex; align-items: center; gap: 6px; padding: 3px 10px; border: 1px solid #e0a030; border-radius: 12px; background: #fff7e6; color: #8a5a00; font: 12px/18px sans-serif; cursor: pointer; }
#work-chip .work-chip-button:hover { background: #ffedc7; }
#work-chip .work-chip-dot { width: 8px; height: 8px; border-radius: 50%; background: #e0a030; }
#work-pop { display: none; position: absolute; top: 28px; right: 0; width: 260px; padding: 10px; background: #fff; border: 1px solid #ccc; border-radius: 6px; box-shadow: 0 4px 14px rgba(0,0,0,.25); font: 12px/1.5 sans-serif; color: #333; text-align: left; z-index: 100000; cursor: auto; }
#work-chip.open #work-pop { display: block; }
#work-pop .work-pop-title { font-weight: bold; margin-bottom: 2px; }
#work-pop .work-pop-sub { color: #777; margin-bottom: 8px; }
#work-pop input { width: 100%; box-sizing: border-box; margin-bottom: 6px; }
#work-pop button { width: 100%; padding: 4px; cursor: pointer; }
#work-pop .work-pop-status { margin-top: 6px; color: #777; word-break: break-word; }
#work-pop .work-pop-status.error { color: #b00020; }
#work-prompt { position: fixed; top: 44px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(30,30,30,.95); color: #fff; font: 12px/1.5 sans-serif; border-radius: 6px; box-shadow: 0 4px 14px rgba(0,0,0,.4); z-index: 99999; }
#work-prompt button { padding: 3px 10px; cursor: pointer; }
#work-prompt .work-later { background: none; border: none; color: #aaa; text-decoration: underline; }
`;

function MenubarWork( editor ) {

	const guard = editor.work;
	const baseTitle = document.title;

	const style = document.createElement( 'style' );
	style.textContent = STYLE;
	document.head.appendChild( style );

	const container = new UIPanel();
	container.setId( 'work-chip' );

	const button = document.createElement( 'div' );
	button.className = 'work-chip-button';
	button.innerHTML = '<span class="work-chip-dot"></span><span>Uncommitted changes</span>';
	container.dom.appendChild( button );

	const pop = document.createElement( 'div' );
	pop.id = 'work-pop';
	pop.innerHTML = '<div class="work-pop-title">Uncommitted changes</div><div class="work-pop-sub"></div>';
	container.dom.appendChild( pop );

	const sub = pop.querySelector( '.work-pop-sub' );

	const input = document.createElement( 'input' );
	input.type = 'text';
	input.value = 'Update scene';
	pop.appendChild( input );

	const commit = document.createElement( 'button' );
	commit.textContent = 'Commit';
	pop.appendChild( commit );

	const statusLine = document.createElement( 'div' );
	statusLine.className = 'work-pop-status';
	pop.appendChild( statusLine );

	let busy = false;

	function setStatus( text, isError ) {

		statusLine.textContent = text;
		statusLine.classList.toggle( 'error', !! isError );

	}

	function refreshPop( status ) {

		const git = currentGitSource();
		const saved = status.savedAt ? `Autosaved locally ${ relativeTime( status.savedAt ) }.` : 'Not autosaved yet.';

		if ( ! git ) {

			sub.textContent = saved + ' No repository is set.';
			commit.textContent = 'Open Git tab';
			input.style.display = 'none';

		} else if ( ! git.hasToken ) {

			sub.textContent = saved + ` Committing to ${ git.repo } needs a token.`;
			commit.textContent = 'Open Git tab';
			input.style.display = 'none';

		} else {

			sub.textContent = saved + ` Commit to ${ git.repo } (${ git.branch || 'main' }).`;
			commit.textContent = 'Commit';
			input.style.display = '';

		}

	}

	function open() {

		refreshPop( guard.status() );
		setStatus( '', false );
		container.dom.classList.add( 'open' );

		const git = currentGitSource();

		if ( git && git.hasToken && editor.aiEngine && editor.aiEngine.ready && input.value === 'Update scene' ) {

			generateCommitMessage( editor ).then( msg => { if ( msg && input.value === 'Update scene' ) input.value = msg; } ).catch( () => {} );

		}

	}

	button.addEventListener( 'click', function () {

		if ( container.dom.classList.contains( 'open' ) ) container.dom.classList.remove( 'open' );
		else open();

	} );

	document.addEventListener( 'mousedown', function ( event ) {

		if ( ! container.dom.contains( event.target ) ) container.dom.classList.remove( 'open' );

	} );

	commit.addEventListener( 'click', async function () {

		if ( busy ) return;

		const git = currentGitSource();

		if ( ! git || ! git.hasToken ) {

			container.dom.classList.remove( 'open' );
			const tab = document.getElementById( 'git' );
			if ( tab ) tab.click();
			return;

		}

		busy = true;
		commit.disabled = true;

		try {

			await commitSceneToRepo( editor, input.value, { onProgress: ( fraction, message ) => setStatus( message, false ) } );
			input.value = 'Update scene';
			container.dom.classList.remove( 'open' );

		} catch ( err ) {

			setStatus( 'Commit failed: ' + err.message, true );

		} finally {

			busy = false;
			commit.disabled = false;

		}

	} );

	guard.onChange( function ( status ) {

		container.dom.classList.toggle( 'dirty', status.dirty );
		button.title = 'Uncommitted changes — click to commit';
		document.title = status.dirty ? '● ' + baseTitle : baseTitle;
		if ( ! status.dirty ) container.dom.classList.remove( 'open' );

	} );

	guard.onOffer( function ( offer ) { showRecoverPrompt( guard, offer ); } );

	return container;

}

let promptEl = null;

function showRecoverPrompt( guard, { entry, file, changes, more, entries } ) {

	if ( promptEl ) promptEl.remove();

	const el = document.createElement( 'div' );
	el.id = 'work-prompt';
	promptEl = el;

	const text = document.createElement( 'span' );
	text.textContent = recoverPrompt( { savedAt: entry.savedAt, file, changes, more } );
	text.title = 'Autosaved in this browser. Recover puts these changes back on screen; Discard deletes this copy.';
	el.appendChild( text );

	function add( label, className, handler ) {

		const b = document.createElement( 'button' );
		b.textContent = label;
		if ( className ) b.className = className;
		b.addEventListener( 'click', handler );
		el.appendChild( b );

	}

	function run( action ) {

		return async function () {

			el.querySelectorAll( 'button' ).forEach( b => { b.disabled = true; } );
			if ( promptEl === el ) promptEl = null;
			el.remove();

			try {

				await action( entry );

			} catch ( err ) {

				console.warn( 'WorkGuard: recover/discard failed —', err );

			}

		};

	}

	add( 'Recover', '', run( e => guard.recover( e ) ) );
	add( 'Discard', '', run( e => guard.discard( e ) ) );
	if ( more > 0 ) add( 'Discard all', '', run( () => guard.discardAll( entries ) ) );
	add( 'Later', 'work-later', function () { if ( promptEl === el ) promptEl = null; el.remove(); } );

	document.body.appendChild( el );

}

export { MenubarWork };
