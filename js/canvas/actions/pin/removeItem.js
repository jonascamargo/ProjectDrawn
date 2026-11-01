// × ao lado de um item de lista / par de dicionário / chave de objeto: remove só aquele item.
export default {
  id: 'pin.removeItem',
  area: 'pin',
  priority: 20,
  press: {
    when: (c) => c.hit.kind === 'gremove',
    run(c) {
      const { graph: gc, fileId, hit } = c;
      if (hit.keyId) gc.setKey(fileId, hit.nodeId, hit.keyId, null);
      else gc.removeDynamicPinAt(fileId, hit.nodeId, hit.index);
    },
  },
  hover: {
    when: (c) => c.hit.kind === 'gremove',
    run: () => 'pointer',
  },
};
