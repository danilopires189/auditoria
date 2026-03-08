#!/usr/bin/env python3
"""
Script FORÇADO para limpar duplicatas do BD_END.xlsx
Remove duplicatas de forma mais agressiva e robusta
"""

import pandas as pd
import shutil
from datetime import datetime
import os

def limpar_duplicatas_forcado():
    """Remove duplicatas do BD_END.xlsx de forma forçada"""
    
    arquivo_original = 'data/BD_END.xlsx'
    
    if not os.path.exists(arquivo_original):
        print(f"❌ Arquivo não encontrado: {arquivo_original}")
        return False
    
    arquivo_backup = f'data/BD_END_backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'
    
    print("=== LIMPEZA FORÇADA DE DUPLICATAS BD_END.xlsx ===\n")
    
    try:
        # Fazer backup
        shutil.copy2(arquivo_original, arquivo_backup)
        print(f"✅ Backup criado: {arquivo_backup}")
        
        # Ler o arquivo Excel
        print("📖 Lendo arquivo Excel...")
        df = pd.read_excel(arquivo_original, sheet_name='DB_END')
        print(f"📊 Registros originais: {len(df)}")
        
        # Verificar o caso específico do erro
        caso_problema = df[
            (df['cd'] == 4) & 
            (df['coddv'] == 574112) & 
            (df['endereco'] == 'DB1 .050.051.775') & 
            (df['tipo'] == 'SEP')
        ]
        
        print(f"\n🎯 CASO ESPECÍFICO DO ERRO:")
        print(f"   cd=4, coddv=574112, endereco='DB1 .050.051.775', tipo='SEP'")
        print(f"   Registros encontrados: {len(caso_problema)}")
        
        if len(caso_problema) > 1:
            print("❌ CONFIRMADO: Há duplicatas deste registro específico")
            print("\n🔍 Detalhes dos registros duplicados:")
            print(caso_problema[['cd', 'coddv', 'endereco', 'andar', 'validade', 'tipo', 'descricao']].to_string(index=False))
        
        # Verificar todas as duplicatas possíveis
        print(f"\n🔍 VERIFICANDO TODAS AS DUPLICATAS...")
        
        # Duplicatas na chave completa
        dup_completa = df.duplicated(subset=['cd', 'coddv', 'endereco', 'andar', 'validade', 'tipo'], keep=False)
        print(f"   Chave completa (cd,coddv,endereco,andar,validade,tipo): {dup_completa.sum()} registros")
        
        # Duplicatas na chave do erro
        dup_erro = df.duplicated(subset=['cd', 'coddv', 'endereco', 'tipo'], keep=False)
        print(f"   Chave do erro (cd,coddv,endereco,tipo): {dup_erro.sum()} registros")
        
        # Duplicatas simples
        dup_simples = df.duplicated(subset=['cd', 'coddv', 'endereco'], keep=False)
        print(f"   Chave simples (cd,coddv,endereco): {dup_simples.sum()} registros")
        
        # LIMPEZA AGRESSIVA - remover duplicatas em múltiplos níveis
        print(f"\n🧹 EXECUTANDO LIMPEZA AGRESSIVA...")
        
        # 1. Primeiro, limpar duplicatas exatas (todas as colunas iguais)
        df_step1 = df.drop_duplicates(keep='first')
        removidos_step1 = len(df) - len(df_step1)
        print(f"   Passo 1 - Duplicatas exatas removidas: {removidos_step1}")
        
        # 2. Limpar duplicatas na chave do erro
        df_step2 = df_step1.drop_duplicates(subset=['cd', 'coddv', 'endereco', 'tipo'], keep='first')
        removidos_step2 = len(df_step1) - len(df_step2)
        print(f"   Passo 2 - Duplicatas chave erro removidas: {removidos_step2}")
        
        # 3. Limpar duplicatas na chave completa (se necessário)
        df_final = df_step2.drop_duplicates(subset=['cd', 'coddv', 'endereco', 'andar', 'validade', 'tipo'], keep='first')
        removidos_step3 = len(df_step2) - len(df_final)
        print(f"   Passo 3 - Duplicatas chave completa removidas: {removidos_step3}")
        
        total_removidos = len(df) - len(df_final)
        print(f"\n📊 RESULTADO FINAL:")
        print(f"   Registros originais: {len(df)}")
        print(f"   Registros finais: {len(df_final)}")
        print(f"   Total removidos: {total_removidos}")
        
        if total_removidos > 0:
            # Verificar se o caso específico foi resolvido
            caso_final = df_final[
                (df_final['cd'] == 4) & 
                (df_final['coddv'] == 574112) & 
                (df_final['endereco'] == 'DB1 .050.051.775') & 
                (df_final['tipo'] == 'SEP')
            ]
            
            print(f"\n✅ VERIFICAÇÃO DO CASO ESPECÍFICO:")
            print(f"   Registros restantes: {len(caso_final)}")
            
            if len(caso_final) <= 1:
                print("   ✅ PROBLEMA RESOLVIDO!")
            else:
                print("   ❌ AINDA HÁ DUPLICATAS!")
            
            # Salvar arquivo limpo
            print(f"\n💾 SALVANDO ARQUIVO LIMPO...")
            with pd.ExcelWriter(arquivo_original, engine='openpyxl') as writer:
                df_final.to_excel(writer, sheet_name='DB_END', index=False)
            
            print(f"✅ Arquivo salvo: {arquivo_original}")
            
            # Verificação final
            duplicatas_finais = df_final.duplicated(subset=['cd', 'coddv', 'endereco', 'tipo'], keep=False).sum()
            if duplicatas_finais == 0:
                print("✅ LIMPEZA CONCLUÍDA COM SUCESSO!")
                print("   Nenhuma duplicata restante na chave do erro")
                return True
            else:
                print(f"⚠️  Ainda restam {duplicatas_finais} duplicatas")
                return False
        else:
            print("✅ Nenhuma duplicata encontrada - arquivo já estava limpo")
            return True
            
    except Exception as e:
        print(f"❌ Erro na limpeza: {e}")
        # Restaurar backup se houver erro
        try:
            if os.path.exists(arquivo_backup):
                shutil.copy2(arquivo_backup, arquivo_original)
                print(f"🔄 Backup restaurado")
        except:
            pass
        return False

if __name__ == "__main__":
    sucesso = limpar_duplicatas_forcado()
    if sucesso:
        print("\n🎉 PRONTO PARA SINCRONIZAÇÃO!")
        print("Execute: sync_backend_cli.exe sync --table db_end")
    else:
        print("\n❌ LIMPEZA FALHOU - verifique manualmente o arquivo Excel")
    
    input("\nPressione Enter para continuar...")