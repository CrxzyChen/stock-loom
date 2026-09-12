// Runtime for the deliberately small schema vocabulary accepted by our generator.
export function matchesSchema(schema,value,definitions){
  if(schema.$ref)return matchesSchema(definitions[schema.$ref.slice(8)],value,definitions);
  if('const' in schema)return value===schema.const;
  if(schema.enum)return schema.enum.includes(value);
  if(schema.anyOf)return schema.anyOf.some(s=>matchesSchema(s,value,definitions));
  switch(schema.type){
    case 'null':return value===null;
    case 'boolean':return typeof value==='boolean';
    case 'string':return typeof value==='string';
    case 'integer':case 'number':return typeof value==='number'&&Number.isFinite(value)&&(schema.type!=='integer'||Number.isInteger(value))&&(!('minimum' in schema)||value>=schema.minimum)&&(!('maximum' in schema)||value<=schema.maximum);
    case 'array':return Array.isArray(value)&&(!("minItems" in schema)||value.length>=schema.minItems)&&(!("maxItems" in schema)||value.length<=schema.maxItems)&&value.every(v=>matchesSchema(schema.items,v,definitions));
    case 'object':return value!==null&&typeof value==='object'&&!Array.isArray(value)&&(schema.required??[]).every(k=>Object.hasOwn(value,k))&&Object.keys(value).every(k=>Object.hasOwn(schema.properties,k)&&matchesSchema(schema.properties[k],value[k],definitions));
    default:throw Error('Unsupported contract schema');
  }
}
