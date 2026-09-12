"""Validator for the schema vocabulary accepted by generate-contracts.mjs."""
import math

def equal_literal(a,b):
    if type(a) in (int,float) and type(b) in (int,float):return a==b
    return type(a) is type(b) and a==b

def matches_schema(schema,value,definitions):
    if '$ref' in schema:return matches_schema(definitions[schema['$ref'][8:]],value,definitions)
    if 'const' in schema:return equal_literal(value,schema['const'])
    if 'enum' in schema:return any(equal_literal(value,item) for item in schema['enum'])
    if 'anyOf' in schema:return any(matches_schema(s,value,definitions) for s in schema['anyOf'])
    kind=schema['type']
    if kind=='null':return value is None
    if kind=='boolean':return type(value) is bool
    if kind=='string':return type(value) is str
    if kind in ('integer','number'):
        return type(value) in (int,float) and (type(value) is int or math.isfinite(value)) and (kind!='integer' or value==int(value)) and ('minimum' not in schema or value>=schema['minimum']) and ('maximum' not in schema or value<=schema['maximum'])
    if kind=='array':return type(value) is list and ('minItems' not in schema or len(value)>=schema['minItems']) and ('maxItems' not in schema or len(value)<=schema['maxItems']) and all(matches_schema(schema['items'],v,definitions) for v in value)
    if kind=='object':return type(value) is dict and all(k in value for k in schema.get('required',[])) and all(k in schema['properties'] and matches_schema(schema['properties'][k],v,definitions) for k,v in value.items())
    raise ValueError('Unsupported contract schema')
