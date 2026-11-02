// Linguagens dos testes, registradas: a de teste (.gd) e a segunda (.gdshader).
// language: a de teste já registrada (nós com as regras do conceito e a linguagem marcada).
import { Languages } from '../js/core/languages.js';
import { language as teste } from '../js/lang/teste/index.js';
import { language as teste2 } from '../js/lang/teste2/index.js';

export const languages = new Languages([teste, teste2]);
export const language = languages.get('teste');
