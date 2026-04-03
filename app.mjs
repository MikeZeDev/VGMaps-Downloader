import fs from 'fs';
import inquirer from 'inquirer';
import path from 'path';
import pLimit from 'p-Limit';
import { JSDOM } from 'jsdom';

const WEBSITE = 'https://vgmaps.de';

main().catch(err => console.log(err.message, err.stack)).finally(() => {
    console.log('end');
});

async function main() {

    //1 : Récupère la liste des plateFormes
    const listePlateformes = await fetchListePlateformes();

    //2 : Choix de la plateforme par l'utilisateur
    const plateforme = await selectPlateforme(listePlateformes);

    //3: Récupère la liste des jeux de la plateforme
    const listeJeux = await fetchListeJeux(plateforme);

    //4: Choix du jeu par l'utilisateur
    const jeu = await selectJeux(listeJeux);

    //5: Liste les maps du jeu 
    const maps = await fetchlisteMaps(jeu);
    console.log(`${maps.length} maps trouvées.`);

    //6: Récupere les urls des images de maps
    const mapsUrls = await fetchMapsUrls(maps);

    //7: Télécharge les images
    await saveMaps(plateforme, jeu, mapsUrls);
}

/**
 * Récupère la liste des plateformes 
 * @returns un tableau de plateformes {name, url}
 */
async function fetchListePlateformes() {
    const anchors = await fetchElements(new URL('/maps/', WEBSITE).href, 'a.SystemLink');
    const plateformes = anchors.map(anchor => {
        return {
            name: anchor.querySelector('img').alt.trim().replace(/\.\s*$/, ''), url: anchor.pathname
        }
    }).sort((self, other) => self.name.localeCompare(other.name));
    return plateformes.filter((item, index, self) =>
        self.findIndex(i => i.name === item.name) === index
    )
}


/**
 * Laisse l'utilisateur choisir une plateforme dans la liste
 * @param {any} listePlateformes liste de plateformes
 * @returns
 */
async function selectPlateforme(listePlateformes) {
    const prompt = await inquirer.prompt([
        {
            type: 'list',
            name: 'result',
            message: 'Choisir la plateforme:',
            choices: listePlateformes.map(plateforme => ({
                name: `${plateforme.name}`,
                value: plateforme
            }))
        }
    ]);
    return prompt.result;
}


/**
 * Récupère la liste des jeux de la plateforme 
 * @returns un tableau de jeux {name, url}
 */
async function fetchListeJeux(plateforme) {
    const plateformeURL = new URL(plateforme.url, WEBSITE);
    const anchors = await fetchElements(plateformeURL.href, 'a.GameLink');
    return anchors.map(anchor => {
        return {
            name: anchor.querySelector('div.GameLinkTitle').textContent.trim(), url: new URL(anchor.pathname, plateformeURL).pathname
        }
    });
}

/**
 * Laisse l'utilisateur choisir un jeu dans la liste
 * @param {any} listeJeux liste de jeux
 * @returns
 */
async function selectJeux(listeJeux) {
    const prompt = await inquirer.prompt([
        {
            type: 'list',
            name: 'result',
            message: 'Choisir le jeu:',
            choices: listeJeux.map(jeu => ({
                name: `${jeu.name}`,
                value: jeu
            }))
        }
    ]);
    return prompt.result;
}

/**
 * Récupère la liste des maps du jeu
 * @returns un tableau de maps (name, url)
 */
async function fetchlisteMaps(jeu) {
    const jeuUrl = new URL(jeu.url, WEBSITE);
    const anchors = await fetchElements(jeuUrl.href, 'a.MapLink');
    return anchors.map(anchor => {
        return {
            name: anchor.querySelector('div.MapLinkHeader').textContent.replace(/^Creator:\s*.*/m, '').trim(), url: new URL(anchor.pathname, jeuUrl).pathname + anchor.search
        }
    });
}


/**
 * Récupere l'url des images des maps
 * @param {Maps} maps - >tableau de maps  
 * @returns 
 */
async function fetchMapsUrls(maps) {
    const result = [];

    for (const map of maps) {
        console.log(`Récupération du lien de l'image de la map ${map.name}....`,);
        let [image] = await fetchElements(new URL(map.url, WEBSITE).href, 'img#MapViewerImage')
        while (!image) {
            console.log(`Petite pause......`,);
            await new Promise(resolve => setTimeout(resolve, 10000));
            [image] = await fetchElements(new URL(map.url, WEBSITE).href, 'img#MapViewerImage')
        };
        console.log(`Lien trouvé : ${ image.src }`, );

        result.push({
            name: map.name, url: image.src
        });
    }
    return result;
}

/** Télécharge les images des maps
 * @param {Plateforme} plateforme - { name, url }
 * @param {Jeu} jeu - { name, url }
 * @param {MapsUrls} - tableau de mapsUrl {name, url }
 * @returns
 */
async function saveMaps(plateforme, jeu, mapsUrls) {
    const chemin = path.join('.', sanitizePath(plateforme.name), sanitizePath(jeu.name));
    await fs.promises.mkdir(chemin, { recursive: true });

    const limit = pLimit(3);
    const promises = mapsUrls.map((map, index) => {
        const imagePath = path.resolve(chemin, sanitizePath(`000${index}-${map.url.split('/').at(-1)}`));
        return limit(() => downloadImage(map.url, imagePath));
    });
    await Promise.all(promises);
    return;
}

/**
 * Télécharge la ressource {url} dans le fichier {path}
 * @param {string} url - lien du fichier
 * @param {string} path - chemin de fichier
 * @returns
 */
async function downloadImage(url, path) {
    console.log(`\r\n Téléchargement de ${url}`);
    const res = await fetch(url);
    console.log(`\r\n Enregistré sous ${path}`);
    fs.writeFileSync(path, new Uint8Array(await res.arrayBuffer()));
}
/**
 * Nettoie le chemin de fichier
 * @param {string} path - chemin de fichier
 * @returns 
 */
function sanitizePath(path) {
    //replace C0 && C1 control codes
    path = path.replace(/[\u0000-\u001F\u007F-\u009F]/gu, '');

    if (process.platform.indexOf('win32') === 0) {
        // TODO: max. 260 characters per path
        path = path.replace(/[\\/:*?"<>|]/g, '');
    }
    if (process.platform.indexOf('linux') === 0) {
        path = path.replace(/[/]/g, '');
    }

    if (process.platform.indexOf('darwin') === 0) {
        // TODO: max. 32 chars per part
        path = path.replace(/[/:]/g, '');
    }
    return path.replace(/[.\s]+$/g, '').trim();
}


async function fetchElements(url, selector) {
    const dom = await fetchHTML(url);
    return [...dom.window.document.querySelectorAll(selector)]
}

async function fetchHTML(url) {
    const response = await fetch(url);
    const data = await response.text();

    return new JSDOM(data, {
        url
    });
}