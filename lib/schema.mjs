// 小型 fail-closed JSON Schema 校验器。未实现关键字明确阻止调用，不声称支持完整规范。
const supported = new Set(['type','properties','required','additionalProperties','items','enum','const','minimum','maximum','exclusiveMinimum','exclusiveMaximum','minLength','maxLength','minItems','maxItems','uniqueItems','pattern','anyOf','oneOf','allOf','not','title','description','default','examples','$schema','$id','$comment','deprecated','readOnly','writeOnly']);
export function validate(value, schema, path = '$') {
  const errors = [];
  if (schema === true) return errors;
  if (schema === false) return [`${path}: 禁止此值`];
  if (!schema || typeof schema !== 'object') return [`${path}: 无效 schema`];
  for (const key of Object.keys(schema)) if (!supported.has(key)) errors.push(`${path}: 尚不支持 schema 关键字 ${key}，停止调用`);
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some(t => ({null:value===null,array:Array.isArray(value),object:!!value&&typeof value==='object'&&!Array.isArray(value),integer:Number.isInteger(value),number:typeof value==='number'&&Number.isFinite(value),string:typeof value==='string',boolean:typeof value==='boolean'})[t])) return [...errors,`${path}: 类型不匹配`];
  if (schema.enum && !schema.enum.some(x=>JSON.stringify(x)===JSON.stringify(value))) errors.push(`${path}: 不在 enum 中`);
  if ('const' in schema && JSON.stringify(schema.const)!==JSON.stringify(value)) errors.push(`${path}: 不等于 const`);
  for (const key of ['anyOf','oneOf','allOf']) if (schema[key]) {
    const valid = schema[key].filter(s=>validate(value,s,path).length===0).length;
    if ((key==='anyOf'&&valid===0)||(key==='oneOf'&&valid!==1)||(key==='allOf'&&valid!==schema[key].length)) errors.push(`${path}: 不满足 ${key}`);
  }
  if(schema.not && !validate(value,schema.not,path).length) errors.push(`${path}: 满足禁止条件`);
  if (typeof value==='number') {
    for(const [key,cmp] of Object.entries({minimum:(a,b)=>a<b,maximum:(a,b)=>a>b,exclusiveMinimum:(a,b)=>a<=b,exclusiveMaximum:(a,b)=>a>=b})) if(key in schema&&cmp(value,schema[key])) errors.push(`${path}: 不满足 ${key}`);
  }
  if(typeof value==='string') {
    if(schema.minLength!=null&&value.length<schema.minLength)errors.push(`${path}: 字符太少`);
    if(schema.maxLength!=null&&value.length>schema.maxLength)errors.push(`${path}: 字符太多`);
    if(schema.pattern) {try {if(!new RegExp(schema.pattern,'u').test(value))errors.push(`${path}: 不满足 pattern`);}catch{errors.push(`${path}: 无效 pattern`);}}
  }
  if(Array.isArray(value)) {
    if(schema.minItems!=null&&value.length<schema.minItems)errors.push(`${path}: 元素太少`);
    if(schema.maxItems!=null&&value.length>schema.maxItems)errors.push(`${path}: 元素太多`);
    if(schema.uniqueItems && new Set(value.map(x=>JSON.stringify(x))).size!==value.length)errors.push(`${path}: 元素重复`);
    if(schema.items)value.forEach((x,i)=>errors.push(...validate(x,schema.items,`${path}[${i}]`)));
  } else if(value && typeof value==='object') {
    for(const key of schema.required||[])if(!(key in value))errors.push(`${path}.${key}: 必填`);
    for(const [key,v]of Object.entries(value)) {
      if(schema.properties?.[key])errors.push(...validate(v,schema.properties[key],`${path}.${key}`));
      else if(schema.additionalProperties===false)errors.push(`${path}: 包含未声明字段`);
      else if(schema.additionalProperties && typeof schema.additionalProperties==='object') errors.push(...validate(v,schema.additionalProperties,`${path}.*`));
    }
  }
  return errors;
}
