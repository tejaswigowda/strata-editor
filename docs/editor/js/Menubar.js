import { UIPanel } from './libs/ui.js';

import { MenubarEdit } from './Menubar.Edit.js';
import { MenubarFile } from './Menubar.File.js';
import { MenubarView } from './Menubar.View.js';
import { MenubarStatus } from './Menubar.Status.js';
import { showWelcomeOverlay } from './WelcomeOverlay.js';

function Menubar( editor ) {

	const container = new UIPanel();
	container.setId( 'menubar' );

	// Add Strata logo to the top-left — click opens the welcome/tutorials overlay
	const logoEl = document.createElement( 'img' );
	logoEl.id = 'menubar-logo';
	logoEl.src = './icon.png';
	logoEl.alt = 'Strata';
	logoEl.title = 'About Strata & tutorials';
	logoEl.style.cursor = 'pointer';
	logoEl.addEventListener( 'click', showWelcomeOverlay );
	container.dom.appendChild( logoEl );

	container.add( new MenubarFile( editor ) );
	container.add( new MenubarEdit( editor ) );
	container.add( new MenubarView( editor ) );

	container.add( new MenubarStatus( editor ) );

	return container;

}

export { Menubar };
