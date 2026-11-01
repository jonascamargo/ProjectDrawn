import { registerActions } from './registry.js';

// Lista das ações do canvas, por área. Ação nova = arquivo novo + uma linha aqui.
// A ordem vale como desempate entre ações de mesma prioridade.

import canvasCreate from './canvas/create.js';
import canvasImportScripts from './canvas/importScripts.js';
import canvasImportGodot from './canvas/importGodot.js';
import canvasPaste from './canvas/paste.js';
import canvasExportAll from './canvas/exportAll.js';
import canvasSelectAll from './canvas/selectAll.js';
import canvasFit from './canvas/fit.js';
import canvasSnap from './canvas/snap.js';
import canvasClearSelection from './canvas/clearSelection.js';
import canvasLasso from './canvas/lasso.js';
import canvasZoom from './canvas/zoom.js';
import canvasSpacePan from './canvas/spacePan.js';

import itemMenuSelect from './item/menuSelect.js';
import itemToggle from './item/toggle.js';
import itemResize from './item/resize.js';
import itemMove from './item/move.js';
import itemRename from './item/rename.js';
import itemProperties from './item/properties.js';
import itemCopy from './item/copy.js';
import itemDuplicate from './item/duplicate.js';
import itemDelete from './item/delete.js';

import folderPasteInside from './folder/pasteInside.js';

import fileViewCode from './file/viewCode.js';
import fileImportCode from './file/importCode.js';
import fileReferenceInScript from './file/referenceInScript.js';
import fileInstanceInScene from './file/instanceInScene.js';
import fileScriptInScene from './file/scriptInScene.js';

import scriptHoverInfo from './script/hoverInfo.js';
import scriptSearch from './script/search.js';
import scriptPasteHere from './script/pasteHere.js';
import scriptOrganizeTree from './script/organizeTree.js';
import scriptStrictTypes from './script/strictTypes.js';
import scriptLasso from './script/lasso.js';
import scriptDropFromPanel from './script/dropFromPanel.js';

import scopeToggle from './scope/toggle.js';
import scopeResize from './scope/resize.js';
import scopeMove from './scope/move.js';
import scopeDelete from './scope/delete.js';

import nodeMenuSelect from './node/menuSelect.js';
import nodeSpawnAccess from './node/spawnAccess.js';
import nodeMove from './node/move.js';
import nodeOpenLinkedFile from './node/openLinkedFile.js';
import nodeDynamicPins from './node/dynamicPins.js';
import nodeOrganizeTree from './node/organizeTree.js';
import nodeCopy from './node/copy.js';
import nodeDuplicate from './node/duplicate.js';
import nodeDelete from './node/delete.js';
import nodeClearSelection from './node/clearSelection.js';
import nodeFitSelection from './node/fitSelection.js';
import nodePaste from './node/paste.js';

import rerouteRemove from './reroute/remove.js';
import rerouteRotate from './reroute/rotate.js';

import commentResize from './comment/resize.js';

import pinDisconnect from './pin/disconnect.js';
import pinConnect from './pin/connect.js';
import pinEditDefault from './pin/editDefault.js';

import wireSelect from './wire/select.js';
import wireInsertReroute from './wire/insertReroute.js';
import wireLabel from './wire/label.js';
import wireDelete from './wire/delete.js';

import labelMove from './label/move.js';

registerActions([
  canvasCreate, canvasImportScripts, canvasImportGodot, canvasPaste, canvasExportAll, canvasSelectAll,
  canvasFit, canvasSnap, canvasClearSelection, canvasLasso, canvasZoom, canvasSpacePan, itemMenuSelect,
  itemToggle, itemResize, itemMove, itemRename, itemProperties, itemCopy, itemDuplicate, itemDelete,
  folderPasteInside, fileViewCode, fileImportCode, fileReferenceInScript, fileInstanceInScene,
  fileScriptInScene, scriptHoverInfo, scriptSearch, scriptPasteHere, scriptOrganizeTree, scriptStrictTypes,
  scriptLasso, scriptDropFromPanel, scopeToggle, scopeResize, scopeMove, scopeDelete, nodeMenuSelect,
  nodeSpawnAccess, nodeMove, nodeOpenLinkedFile, nodeDynamicPins, nodeOrganizeTree, nodeCopy, nodeDuplicate,
  nodeDelete, nodeClearSelection, nodeFitSelection, nodePaste, rerouteRemove, rerouteRotate, commentResize, pinDisconnect,
  pinConnect, pinEditDefault, wireSelect, wireInsertReroute, wireLabel, wireDelete, labelMove,
]);
