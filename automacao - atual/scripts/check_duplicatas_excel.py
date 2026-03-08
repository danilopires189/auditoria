#!/usr/bin/env python3
"""
Script para verificar duplicatas no Excel BD_END.xlsx
Identifica exatamente onde estão as duplicatas que causam erro
"""

import pandas as pd

def verificar_duplicatas_excel():
    """Verifica duplicatas no Excel que causam erro de sincronização"""
    
    print("=== VERIFICAÇÃO DE DUPLICATAS NO EXCEL ===\n")
    
    try:
        # Ler o arquivo Excel
        df = pd.read_excel('data/BD_END.xlsx', sheet_name='DB_END')
        print(f"✅ Excel carregado: {len(df)} registros")
        
        # Verificar duplicatas na chave única completa
        # cd, coddv, endereco, andar, validade, tipo
        duplicatas = df.duplicated(subset=['cd', 'coddv', 'endereco', 'andar', 'validade', 'tipo'], keep=False)
        
        if duplicatas.any():
            print(f"❌ DUPLICATAS ENCONTRADAS: {duplicatas.sum()} registros")
            print("\n🔍 REGISTROS DUPLICADOS:")
            
            df_duplicatas = df[duplicatas].sort_values(['cd', 'coddv', 'endereco', 'tipo'])
            print(df_duplicatas[['cd', 'coddv', 'endereco', 'andar', 'validade', 'tipo', 'descricao']].to_string(index=False))
            
            # Verificar o caso específico do erro
            caso_erro = df[(df['cd'] == 4) & (df['coddv'] == 574112) & (df['endereco'] == 'DB1 .050.051.775') & (df['tipo'] == 'SEP')]
            
            if len(caso_erro) > 0:
                print(f"\n🎯 CASO ESPECÍFICO DO ERRO (cd=4, coddv=574112, endereco='DB1 .050.051.775', tipo='SEP'):")
                print(f"Encontrados {len(caso_erro)} registros:")
                print(caso_erro[['cd', 'coddv', 'endereco', 'andar', 'validade', 'tipo', 'descricao']].to_string(index=False))
            
            # Agrupar duplicatas por combinação
            grupos = df[duplicatas].groupby(['cd', 'coddv', 'endereco', 'andar', 'validade', 'tipo']).size().sort_values(ascending=False)
            print(f"\n📊 TOP 10 COMBINAÇÕES COM MAIS DUPLICATAS:")
            print(grupos.head(10).to_string())
            
        else:
            print("✅ NENHUMA DUPLICATA ENCONTRADA!")
            print("O problema pode estar em outro lugar...")
        
        # Verificar outras possíveis duplicatas
        print(f"\n=== OUTRAS VERIFICAÇÕES ===")
        
        # Duplicatas só por cd, coddv, endereco (sem andar, validade, tipo)
        dup_sem_extras = df.duplicated(subset=['cd', 'coddv', 'endereco'], keep=False)
        if dup_sem_extras.any():
            print(f"⚠️  Duplicatas sem considerar 'andar', 'validade', 'tipo': {dup_sem_extras.sum()} registros")
        
        # Verificar valores nulos nas colunas da chave
        nulos_tipo = df['tipo'].isnull().sum()
        nulos_andar = df['andar'].isnull().sum()
        nulos_validade = df['validade'].isnull().sum()
        
        if nulos_tipo > 0:
            print(f"⚠️  Registros com 'tipo' nulo: {nulos_tipo}")
        if nulos_andar > 0:
            print(f"⚠️  Registros com 'andar' nulo: {nulos_andar}")
        if nulos_validade > 0:
            print(f"⚠️  Registros com 'validade' nulo: {nulos_validade}")
        
        # Verificar espaços em branco
        espacos_tipo = df['tipo'].str.strip().ne(df['tipo']).sum()
        espacos_andar = df['andar'].str.strip().ne(df['andar']).sum()
        espacos_validade = df['validade'].str.strip().ne(df['validade']).sum()
        
        if espacos_tipo > 0:
            print(f"⚠️  Registros com espaços em 'tipo': {espacos_tipo}")
        if espacos_andar > 0:
            print(f"⚠️  Registros com espaços em 'andar': {espacos_andar}")
        if espacos_validade > 0:
            print(f"⚠️  Registros com espaços em 'validade': {espacos_validade}")
            
    except Exception as e:
        print(f"❌ Erro ao verificar Excel: {e}")

if __name__ == "__main__":
    verificar_duplicatas_excel()